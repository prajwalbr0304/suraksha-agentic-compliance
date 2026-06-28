"""Orchestration: monitor -> extract -> MAP -> assign -> persist -> validate.

Each stage uses the ADK agents (Gemini) for reasoning and persists results to
Supabase between stages so the autonomy is observable in the existing dashboards.
All work is tenant-scoped by organization_id.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
import json
from typing import Any

from . import config
from . import supabase_client as sb
from . import agents as A
from .fetchers import DEFAULT_FEEDS, fetch_feed_result
from . import pdf_ingest
from .regulatory_host_allowlist import is_allowed_regulator_pdf_url
from .tools import CURRENT_ORG


def _due(days: int) -> str:
    return (dt.date.today() + dt.timedelta(days=max(1, int(days or 30)))).isoformat()


def _parse_published_dt(raw: Any) -> dt.datetime | None:
    if raw is None:
        return None
    if isinstance(raw, dt.datetime):
        t = raw
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return t
    if isinstance(raw, str):
        try:
            t = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if t.tzinfo is None:
                t = t.replace(tzinfo=dt.timezone.utc)
            return t
        except Exception:
            return None
    return None


def _feed_item_too_old(pub_dt: dt.datetime | None, lookback_days: int) -> bool:
    if lookback_days <= 0 or not pub_dt:
        return False
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=lookback_days)
    return pub_dt < cutoff


def _feed_item_before_watermark(pub_dt: dt.datetime | None, wm_iso: str | None) -> bool:
    if not wm_iso:
        return False
    wm = _parse_published_dt(wm_iso)
    if wm and pub_dt and pub_dt <= wm:
        return True
    return False


# ── Stage 1: RegWatcher ───────────────────────────────────────────────────────

def watch_organization(
    organization_id: str,
    trigger: str = "manual",
    *,
    parent_run_id: str | None = None,
    source_ids_filter: set[str] | None = None,
) -> dict[str, Any]:
    """Fetch enabled feeds for one org and record new regulatory_changes.

    If ``parent_run_id`` is set (e.g. coordinator watch API), log events and
    ``finish_run`` use that run only and no separate ``regwatcher`` row is created.

    ``source_ids_filter`` limits scanning to those regulatory_sources ids (per-source scheduler).
    """
    own_run = not parent_run_id
    run_id = parent_run_id or sb.start_run(organization_id, "regwatcher", trigger)
    sources = [s for s in sb.list_enabled_sources() if s["organization_id"] == organization_id]
    if config.REGULATORY_FEEDS_RBI_ONLY:
        sources = [s for s in sources if (s.get("regulator") or "").strip().upper() == "RBI"]
    # If the org has no configured sources, fall back to the default regulators.
    if not sources:
        feed_pairs = list(DEFAULT_FEEDS.items())
        if config.REGULATORY_FEEDS_RBI_ONLY:
            feed_pairs = [(r, u) for r, u in feed_pairs if r == "RBI"]
        sources = [{"id": None, "regulator": r, "feed_url": u} for r, u in feed_pairs]

    new_changes: list[dict[str, Any]] = []
    for src in sources:
        sid = src.get("id")
        if source_ids_filter is not None:
            sid_s = str(sid) if sid else ""
            if not sid_s or sid_s not in source_ids_filter:
                continue
        fr = fetch_feed_result(src["regulator"], src["feed_url"])
        if sid:
            sb.touch_regulatory_source_fetch(str(sid), bool(fr.get("ok")), fr.get("error"))
        wm_iso = src.get("fetch_watermark_published_at") if sid else None
        try:
            lookback_days = int(src.get("lookback_days") or 7)
        except (TypeError, ValueError):
            lookback_days = 7
        max_pub_this_scan: dt.datetime | None = None

        for it in fr.get("items") or []:
            pub_dt = _parse_published_dt(it.get("published_at"))
            if _feed_item_too_old(pub_dt, lookback_days):
                continue
            if pub_dt and (max_pub_this_scan is None or pub_dt > max_pub_this_scan):
                max_pub_this_scan = pub_dt
            if sid and _feed_item_before_watermark(pub_dt, wm_iso):
                continue
            if sb.change_exists(organization_id, it["external_ref"]):
                continue
            cid = sb.insert_change(organization_id, src.get("id"), src["regulator"], it)
            if cid:
                it["_id"] = cid
                it["_regulator"] = src["regulator"]
                it["_source_id"] = str(sid) if sid else None
                new_changes.append(it)
                sb.log_event(run_id, organization_id, "change_detected", it["title"], {"ref": it["external_ref"]})

        if sid and max_pub_this_scan:
            sb.update_source_watermark_max(str(sid), max_pub_this_scan.isoformat())

    if own_run:
        sb.finish_run(run_id, "completed", f"Detected {len(new_changes)} new regulatory change(s)", {"new": len(new_changes)})
    if new_changes:
        sb.write_audit(organization_id, "regulation_detected", "Regulatory feed",
                       f"{len(new_changes)} new regulatory change(s) detected", metadata={"count": len(new_changes)})
    return {"run_id": run_id, "new_changes": new_changes}


# ── Stage 2-4: Extract -> MAP -> Assign -> persist ────────────────────────────

CYBER_KEYWORDS = ("cyber", "incident", "vapt", "va/pt", "soc", "ransomware", "phishing",
                  "security", "breach", "ddos", "malware")


def _obligation_fingerprint(title: str, department: str, regulation: str) -> str:
    norm_t = " ".join((title or "").lower().split())
    norm_d = (department or "").strip().lower()
    norm_r = (regulation or "").strip().lower()
    key = f"{norm_t}|{norm_d}|{norm_r}"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def _coerce_obligations(data: Any) -> list[dict[str, Any]]:
    """Normalise obligation_extractor output to a list of obligation dicts.

    Accepts {"obligations": [...]} (json-object mode), a bare list, a single
    obligation dict, or a one-key dict wrapping the list.
    """
    if data is None:
        return []
    items: Any = data
    if isinstance(data, dict):
        if isinstance(data.get("obligations"), list):
            items = data["obligations"]
        elif data.get("title"):
            items = [data]
        else:
            items = next((v for v in data.values() if isinstance(v, list)), [])
    if not isinstance(items, list):
        return []
    return [x for x in items if isinstance(x, dict) and x.get("title")]


async def _extract_obligations_list(title: str, extraction_text: str) -> list[dict[str, Any]]:
    if (
        config.PDF_CHUNK_EXTRACTION
        and len(extraction_text) >= config.PDF_CHUNK_MIN_SPLIT_CHARS
    ):
        step = config.PDF_CHUNK_CHARS
        chunks = [extraction_text[i : i + step] for i in range(0, len(extraction_text), step)]
        sem = asyncio.Semaphore(config.PDF_CHUNK_PARALLEL_MAX)

        async def _one(chunk: str, part_i: int) -> list[dict[str, Any]]:
            async with sem:
                ob_raw = await A.run_agent(
                    A.obligation_extractor,
                    "Regulatory circular excerpt (part of a larger document).\n"
                    f"Document title for context: {title}\nPart index: {part_i}\n\n"
                    "Extract every discrete actionable obligation that appears in THIS excerpt only.\n\n"
                    f"{chunk}",
                )
                return _coerce_obligations(A.parse_json(ob_raw))

        part_results = await asyncio.gather(*(_one(chunks[i], i) for i in range(len(chunks))))
        merged: list[dict[str, Any]] = []
        seen_titles: set[str] = set()
        for group in part_results:
            for ob in group:
                tl = " ".join((ob.get("title") or "").lower().split())
                if tl in seen_titles:
                    continue
                seen_titles.add(tl)
                merged.append(ob)
        return merged

    # Cap the single-call prompt so a large PDF doesn't create a multi-minute / timed-out
    # Ollama request (chunked extraction handles big docs when SURAKSHA_PDF_CHUNK_EXTRACTION=1).
    single_text = (extraction_text or "")[: config.PDF_CHUNK_MIN_SPLIT_CHARS]
    ob_raw = await A.run_agent(
        A.obligation_extractor,
        f"Regulatory change:\n\nTitle: {title}\n\n{single_text}",
    )
    return _coerce_obligations(A.parse_json(ob_raw))


def _security_department(departments: list[str]) -> str | None:
    """Find the bank's security/cyber department, if one exists."""
    for d in departments:
        dl = d.lower()
        if "security" in dl or "cyber" in dl or dl == "it":
            return d
    return None


def _hashing_embedding_384(text: str) -> list[float]:
    """Deterministic 384-d embedding for pgvector; replace with a real model when available."""
    dim = 384
    v = [0.0] * dim
    for w in (text or "").lower().split():
        if not w:
            continue
        h = int(hashlib.sha256(w.encode("utf-8")).hexdigest(), 16) % dim
        v[h] += 1.0
    norm = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / norm for x in v]


def _split_text_chunks(text: str, chunk_size: int = 1200) -> list[str]:
    t = (text or "").strip()
    if not t:
        return []
    chunks: list[str] = []
    i = 0
    while i < len(t):
        chunks.append(t[i : i + chunk_size])
        i += chunk_size
    return chunks


async def embed_and_store_regulation_chunks(
    organization_id: str,
    regulatory_change_id: str,
    document_id: str,
    pdf_text: str,
) -> int:
    chunks = _split_text_chunks(pdf_text, 1200)
    if not chunks:
        return 0
    sb.delete_document_chunks_for_document(str(document_id))
    n = 0
    for idx, content in enumerate(chunks):
        emb = _hashing_embedding_384(content)
        vec_lit = "[" + ",".join(f"{x:.8f}" for x in emb) + "]"
        sb.insert_document_chunk_row(
            {
                "organization_id": organization_id,
                "document_id": str(document_id),
                "regulatory_change_id": str(regulatory_change_id),
                "chunk_index": idx,
                "page_number": None,
                "section_ref": None,
                "citation": f"reg-chunk-{idx + 1}",
                "content": content[:50000],
                "metadata": {
                    "embedding_model": "hashing_trick_384",
                    "regulation_center": True,
                },
                "embedding": vec_lit,
            }
        )
        n += 1
    sb.merge_regulatory_change(
        str(regulatory_change_id),
        {"pdf_stage": "embedded"},
    )
    return n


async def maybe_run_regulation_tagger(
    organization_id: str,
    change_id: str,
    *,
    regulator: str,
    title: str,
    summary: str,
) -> None:
    if not config.REGULATION_TAGGER_ENABLED or not config.llm_available():
        return
    try:
        prompt = (
            f"Regulator: {regulator}\nTitle: {title}\nSummary or excerpt:\n"
            f"{(summary or '')[:6000]}"
        )
        raw = await A.run_agent(A.regulation_tagger, prompt)
        data = A.parse_json(raw) or {}
        cat = data.get("category")
        tags = data.get("tags")
        summ = data.get("executive_summary")
        patch: dict[str, Any] = {}
        if isinstance(cat, str) and cat.strip():
            patch["category"] = cat.strip()[:200]
        if isinstance(tags, list):
            patch["tags"] = [str(x).strip()[:80] for x in tags if str(x).strip()][:24]
        if isinstance(summ, str) and summ.strip():
            patch["executive_summary"] = summ.strip()[:2000]
        if patch:
            sb.merge_regulatory_change(str(change_id), patch)
        sb.insert_regulation_processing_log(
            organization_id,
            str(change_id),
            "tagger",
            "success",
            "regulation_tagger applied",
            agent_name="regulation_tagger",
            payload={"keys": list(patch.keys())},
            ended_at=sb.now_iso(),
        )
    except Exception as e:
        sb.insert_regulation_processing_log(
            organization_id,
            str(change_id),
            "tagger",
            "failed",
            str(e)[:1500],
            agent_name="regulation_tagger",
            ended_at=sb.now_iso(),
        )


async def _run_obligations_maps_phase(
    organization_id: str,
    departments: list[str],
    title: str,
    extraction_text: str,
    doc_id: str,
    change_id: str | None,
    regulator_label: str,
    run_id: str,
    *,
    is_cyber: bool,
    sec_dept: str | None,
) -> dict[str, Any]:
    sb.merge_run_stats(
        run_id,
        {
            "pipeline_stage_index": 1,
            "pipeline_stage_key": "extracting",
            "pipeline_stage_label": "Extracting obligations…",
        },
    )

    obligations = await _extract_obligations_list(title, extraction_text)
    sb.log_event(
        run_id,
        organization_id,
        "info",
        f"obligation_extractor: {len(obligations)} obligation(s) from {len(extraction_text or '')} chars of text",
        {"obligations": len(obligations), "text_chars": len(extraction_text or "")},
    )
    created_obl, created_maps = 0, 0
    max_ob = config.MAX_OBLIGATIONS_PER_CHANGE
    max_maps = config.MAX_MAPS_PER_OBLIGATION
    reg_label = regulator_label

    obl_rows: list[tuple[str, dict[str, Any]]] = []
    for ob in obligations[:max_ob]:
        dept_guess = ob.get("suggested_department", "Compliance")
        if not isinstance(dept_guess, str):
            dept_guess = "Compliance"
        fp = _obligation_fingerprint(str(ob.get("title")), dept_guess, str(reg_label))
        if sb.obligation_fingerprint_exists(organization_id, fp):
            sb.log_event(
                run_id,
                organization_id,
                "info",
                f"Skipping duplicate obligation fingerprint: {str(ob.get('title', ''))[:120]}",
                {},
            )
            continue
        ob_id = sb.insert_obligation(
            organization_id,
            doc_id,
            {
                "title": ob.get("title"),
                "description": ob.get("description", ""),
                "regulation": reg_label,
                "priority": ob.get("priority", "medium"),
                "risk": ob.get("risk", "medium"),
                "citation": ob.get("citation"),
                "department": dept_guess,
                "confidence": 82,
                "obligation_fingerprint": fp,
            },
        )
        if not ob_id:
            continue
        created_obl += 1
        obl_rows.append((ob_id, ob))

    if obl_rows:
        sb.merge_run_stats(
            run_id,
            {
                "pipeline_stage_index": 2,
                "pipeline_stage_key": "maps",
                "pipeline_stage_label": "Generating MAPs…",
            },
        )
        payload = {
            "allowed_departments": departments,
            "obligations": [
                {
                    "index": pos,
                    "title": ob.get("title"),
                    "description": ob.get("description", ""),
                    "suggested_department": ob.get("suggested_department", "Compliance"),
                }
                for pos, (_oid, ob) in enumerate(obl_rows)
            ],
        }
        batch_raw = await A.run_agent(
            A.map_and_route_batch,
            "Input JSON:\n" + json.dumps(payload, ensure_ascii=False)[:120000],
        )
        batch_data = A.parse_json(batch_raw) or {}
        # Local models often return the assignments array at the top level, or wrap it under
        # a different key — accept dict{assignments}, dict{any list value}, or a bare list.
        assignments: Any = None
        if isinstance(batch_data, dict):
            assignments = batch_data.get("assignments")
            if not isinstance(assignments, list):
                assignments = next(
                    (v for v in batch_data.values() if isinstance(v, list)), None
                )
        elif isinstance(batch_data, list):
            assignments = batch_data
        by_index: dict[int, list[dict[str, Any]]] = {}
        if isinstance(assignments, list):
            for fallback_pos, a in enumerate(assignments):
                if not isinstance(a, dict):
                    continue
                oi = a.get("obligation_index")
                if isinstance(oi, bool):
                    oi = None
                elif isinstance(oi, float):
                    oi = int(oi)
                elif isinstance(oi, str) and oi.strip().lstrip("-").isdigit():
                    oi = int(oi.strip())
                if not isinstance(oi, int):
                    # No usable index: assume positional alignment with obl_rows order.
                    oi = fallback_pos
                maps = a.get("maps")
                if not isinstance(maps, list):
                    # Some models return a single map dict, or omit the wrapper entirely.
                    maps = [a] if a.get("title") else []
                cleaned = [m for m in maps if isinstance(m, dict) and m.get("title")]
                if cleaned:
                    by_index[oi] = cleaned

        sb.merge_run_stats(
            run_id,
            {
                "pipeline_stage_index": 3,
                "pipeline_stage_key": "routing",
                "pipeline_stage_label": "Assigning departments…",
            },
        )

        for pos, (ob_id, ob) in enumerate(obl_rows):
            maps = by_index.get(pos, [])
            if not maps:
                # Resilience: the local model didn't return MAPs for this obligation.
                # Synthesize a default Measurable Action Point so the obligation is still
                # actioned and routed to a department (core theme: obligation -> MAP -> assign).
                sg = ob.get("suggested_department")
                fb_dept = sg if isinstance(sg, str) and sg in departments else departments[0]
                ob_title = (ob.get("title") or "compliance obligation").strip()
                maps = [
                    {
                        "title": f"Implement and evidence: {ob_title}"[:300],
                        "metric": "Controls implemented and evidenced",
                        "target": "100% compliance",
                        "due_in_days": 30,
                        "evidence_required": ["policy", "implementation evidence"],
                        "priority": ob.get("priority", "medium"),
                        "department": fb_dept,
                    }
                ]
                sb.log_event(
                    run_id,
                    organization_id,
                    "info",
                    "map_and_route_batch returned no MAPs for obligation index "
                    f"{pos}; generated a default MAP routed to {fb_dept}.",
                    {"obligation_title": ob_title[:200], "department": fb_dept},
                )
            for m in maps[:max_maps]:
                dept = m.get("department")
                if not isinstance(dept, str) or dept not in departments:
                    sg = ob.get("suggested_department")
                    dept = sg if isinstance(sg, str) and sg in departments else departments[0]
                if sec_dept:
                    dept = sec_dept
                pr = m.get("priority", ob.get("priority", "medium"))
                if not isinstance(pr, str) or pr not in ("critical", "high", "medium", "low"):
                    pr = "medium"
                map_id = sb.insert_map_card(
                    organization_id,
                    ob_id,
                    {
                        "title": m.get("title"),
                        "department": dept,
                        "priority": pr,
                        "due_date": _due(m.get("due_in_days", 30)),
                        "owner": f"{dept} Lead",
                    },
                )
                if map_id:
                    created_maps += 1
                    sb.log_event(run_id, organization_id, "map_generated", m.get("title", ""), {"department": dept})
                    if is_cyber and pr in ("critical", "high"):
                        sb.insert_escalation(
                            organization_id,
                            obligation_id=ob_id,
                            map_card_id=map_id,
                            escalated_to=f"{dept} Owner",
                            reason=f"Critical cyber obligation auto-routed: {m.get('title')}",
                            severity=pr,
                        )
                        sb.log_event(
                            run_id,
                            organization_id,
                            "escalation",
                            f"Escalated cyber MAP to {dept} Owner",
                            {"map_id": map_id},
                        )

    if doc_id and change_id:
        sb.set_change_status(str(change_id), "mapped", doc_id)
    sb.write_audit(
        organization_id,
        "map_generated",
        title,
        f"Generated {created_maps} MAP(s) from {created_obl} obligation(s) for '{title}'",
        metadata={"obligations": created_obl, "maps": created_maps},
        target_id=doc_id,
    )
    return {"obligations": created_obl, "maps": created_maps, "document_id": doc_id}


async def ingest_regulatory_change(
    organization_id: str,
    change: dict[str, Any],
    run_id: str,
) -> dict[str, Any]:
    """Resolve/download PDF and persist document; set lifecycle for Regulation Center (no obligations)."""
    token = CURRENT_ORG.set(organization_id)
    try:
        title = change.get("title", "Regulatory change")
        raw_summary = (change.get("summary") or title) or ""
        change_id = change.get("_id")
        if not change_id:
            return {"status": "skipped", "reason": "no_change_id"}
        cid_str = str(change_id)
        notification_url = (change.get("url") or "").strip()
        regulator = change.get("_regulator", change.get("regulator", "Regulator"))
        source_key = change.get("_source_id")
        src_row = sb.get_regulatory_source(str(source_key)) if source_key else None
        approval_req = (
            bool(src_row.get("approval_required"))
            if src_row
            else config.REGULATION_APPROVAL_REQUIRED_DEFAULT
        )
        auto_dl = bool(src_row.get("auto_download_pdf", True)) if src_row else True

        sb.insert_regulation_processing_log(
            organization_id,
            cid_str,
            "ingest",
            "started",
            title[:400],
            agent_name="monitoring_agent",
        )

        rc_row = sb.get_regulatory_change(cid_str) or {}
        manual_path = rc_row.get("manual_pdf_storage_path")

        strict = config.AUTOMATIC_PDF_STRICT
        pdf_url: str | None = None
        pdf_bytes: bytes | None = None
        pdf_text = ""
        html_text = ""

        if not auto_dl and not manual_path:
            sb.merge_regulatory_change(
                cid_str,
                {"lifecycle_status": "new", "pdf_stage": "none", "status": "detected"},
            )
            sb.insert_regulation_processing_log(
                organization_id,
                cid_str,
                "ingest",
                "skipped",
                "auto_download_pdf disabled and no manual_pdf_storage_path",
                ended_at=sb.now_iso(),
            )
            return {"status": "ingested_pending_manual", "document_id": None}

        if manual_path:
            pdf_bytes = sb.download_pdf_bytes_from_storage_path(str(manual_path))
            if pdf_bytes:
                pdf_text = pdf_ingest.extract_text_from_pdf_bytes(pdf_bytes)
                sb.log_event(run_id, organization_id, "pdf_manual_storage", title, {"path": str(manual_path)[:200]})
        elif notification_url.startswith("http"):
            pdf_url = pdf_ingest.resolve_pdf_url(notification_url, regulator)
            if pdf_url:
                try:
                    pdf_bytes = pdf_ingest.download_pdf(pdf_url, referer=notification_url)
                    pdf_text = pdf_ingest.extract_text_from_pdf_bytes(pdf_bytes)
                    sb.log_event(run_id, organization_id, "pdf_resolved", title, {"pdf_url": pdf_url[:500]})
                except Exception as e:
                    if change_id:
                        sb.update_regulatory_change_ingestion(
                            cid_str,
                            resolved_pdf_url=pdf_url,
                            ingestion_error=str(e)[:2000],
                        )
                    pdf_bytes = None
                    pdf_text = ""
                    sb.log_event(run_id, organization_id, "pdf_download_failed", str(e)[:480], {})

            if (not pdf_bytes or not pdf_text.strip()) and config.PDF_URL_LLM_FALLBACK and config.llm_available():
                html_snip = pdf_ingest.fetch_notification_html(notification_url) or ""
                if html_snip:
                    try:
                        prompt = (
                            f"Notification URL: {notification_url}\nRegulator: {regulator}\nTitle: {title}\n\n"
                            f"HTML (truncated):\n{html_snip[:12000]}"
                        )
                        tag_raw = await A.run_agent(A.pdf_url_resolver, prompt)
                        data = A.parse_json(tag_raw) or {}
                        cand = data.get("pdf_url")
                        if isinstance(cand, str) and is_allowed_regulator_pdf_url(cand):
                            pdf_url = cand
                            pdf_bytes = pdf_ingest.download_pdf(cand, referer=notification_url)
                            pdf_text = pdf_ingest.extract_text_from_pdf_bytes(pdf_bytes)
                            sb.insert_regulation_processing_log(
                                organization_id,
                                cid_str,
                                "pdf_llm_resolver",
                                "success",
                                f"Resolved PDF URL host={cand[:200]}",
                                agent_name="pdf_url_resolver",
                                payload={"pdf_url": cand[:500]},
                                ended_at=sb.now_iso(),
                            )
                            sb.log_event(run_id, organization_id, "pdf_resolved_llm", title, {"pdf_url": cand[:500]})
                        else:
                            sb.insert_regulation_processing_log(
                                organization_id,
                                cid_str,
                                "pdf_llm_resolver",
                                "no_candidate",
                                "LLM did not return an allowed pdf_url",
                                agent_name="pdf_url_resolver",
                                ended_at=sb.now_iso(),
                            )
                    except Exception as ex:
                        sb.insert_regulation_processing_log(
                            organization_id,
                            cid_str,
                            "pdf_llm_resolver",
                            "failed",
                            str(ex)[:1500],
                            agent_name="pdf_url_resolver",
                            ended_at=sb.now_iso(),
                        )

        # No PDF resolved: capture the notification page text so the document/extraction
        # still has the regulator's actual circular content (RBI notifications are HTML).
        if not pdf_bytes and notification_url.startswith("http"):
            try:
                html_raw = pdf_ingest.fetch_notification_html(notification_url) or ""
                html_text = pdf_ingest.extract_text_from_html(html_raw)
                if html_text.strip():
                    sb.log_event(
                        run_id, organization_id, "html_text_captured", title,
                        {"chars": len(html_text)},
                    )
            except Exception:
                html_text = ""

        use_pdf = bool(pdf_bytes)
        if strict and not use_pdf:
            sb.update_regulatory_change_ingestion(
                cid_str,
                ingestion_error="AUTOMATIC_PDF_STRICT: no PDF could be resolved or downloaded",
            )
            sb.merge_regulatory_change(
                cid_str,
                {
                    "lifecycle_status": "failed_ingest",
                    "status": "error",
                    "pdf_stage": "none",
                },
            )
            sb.log_event(run_id, organization_id, "error", "strict_pdf_missing", {"title": title})
            sb.insert_regulation_processing_log(
                organization_id,
                cid_str,
                "ingest",
                "failed",
                "AUTOMATIC_PDF_STRICT: no PDF",
                ended_at=sb.now_iso(),
            )
            return {"obligations": 0, "maps": 0, "document_id": None}

        doc_id: str | None = None
        if use_pdf and pdf_bytes:
            sha_dup = hashlib.sha256(pdf_bytes).hexdigest()
            dup_change = sb.find_regulatory_duplicate_by_checksum(organization_id, sha_dup, cid_str)
            if dup_change:
                sb.merge_regulatory_change(
                    cid_str,
                    {
                        "lifecycle_status": "duplicate",
                        "status": "duplicate",
                        "duplicate_of_id": dup_change,
                        "pdf_checksum_sha256": sha_dup,
                    },
                )
                sb.insert_regulation_processing_log(
                    organization_id,
                    cid_str,
                    "ingest",
                    "duplicate",
                    f"Same PDF checksum as change {dup_change}",
                    ended_at=sb.now_iso(),
                )
                return {"obligations": 0, "maps": 0, "document_id": None}

        needs_ocr = use_pdf and len((pdf_text or "").strip()) < config.PDF_MIN_TEXT_CHARS

        if use_pdf:
            doc_id = sb.create_document_from_pdf(
                organization_id,
                title,
                regulator,
                raw_summary[:8000],
                notification_url or None,
                pdf_bytes,
                cid_str,
                needs_ocr=needs_ocr,
                resolved_pdf_url=pdf_url,
            )
            if doc_id and needs_ocr:
                sb.log_event(run_id, organization_id, "pdf_needs_ocr", title, {"chars": len(pdf_text or "")})
            elif doc_id:
                sb.log_event(run_id, organization_id, "pdf_ingested", title, {"chars": len(pdf_text or "")})
            elif strict:
                sb.update_regulatory_change_ingestion(
                    cid_str,
                    ingestion_error="AUTOMATIC_PDF_STRICT: storage or document insert failed",
                )
                sb.merge_regulatory_change(
                    cid_str,
                    {"lifecycle_status": "failed_ingest", "status": "error"},
                )
                return {"obligations": 0, "maps": 0, "document_id": None}

        if not doc_id and not strict:
            # Prefer full notification HTML text over the (often empty) RSS summary so
            # the obligation extractor has real regulatory content to work on.
            fallback_text = (
                html_text
                if len(html_text.strip()) > len((raw_summary or "").strip())
                else raw_summary
            )
            doc_id = sb.create_document(organization_id, title, regulator, fallback_text[:60000], change.get("url"))
            if doc_id:
                # create_document (text-only fallback) does not link the change; do it here
                # so the regulation has a document_id and can be approved/processed.
                sb.link_change_document(cid_str, doc_id)
                if html_text.strip() and len(html_text.strip()) > 200:
                    sb.merge_regulatory_change(cid_str, {"raw_text": html_text[:60000]})

        if not doc_id:
            sb.merge_regulatory_change(
                cid_str,
                {"lifecycle_status": "failed_ingest", "status": "error"},
            )
            return {"obligations": 0, "maps": 0, "document_id": None}

        now_iso = sb.now_iso()
        qo = sb.next_regulation_processing_order(organization_id)
        if approval_req:
            lifecycle = "awaiting_approval"
            qpatch: dict[str, Any] = {
                "lifecycle_status": lifecycle,
                "pdf_stage": "ready",
                "status": "detected",
                "processing_order": None,
                "queue_position": None,
                "queued_at": None,
            }
        else:
            qpatch = {
                "lifecycle_status": "queued",
                "pdf_stage": "ready",
                "status": "detected",
                "queued_at": now_iso,
                "processing_order": qo,
                "queue_position": 0,
            }
        sb.merge_regulatory_change(cid_str, qpatch)
        await maybe_run_regulation_tagger(
            organization_id,
            cid_str,
            regulator=regulator,
            title=title,
            summary=f"{raw_summary}\n\n{(pdf_text or '')[:4000]}",
        )
        sb.insert_regulation_processing_log(
            organization_id,
            cid_str,
            "ingest",
            "completed",
            "PDF stored; lifecycle updated",
            ended_at=sb.now_iso(),
        )
        return {"obligations": 0, "maps": 0, "document_id": doc_id}
    finally:
        CURRENT_ORG.reset(token)


async def process_regulation_extraction(organization_id: str, change_id: str, run_id: str) -> dict[str, Any]:
    """Run obligation + MAP extraction for a queued/approved regulation with existing document."""
    token = CURRENT_ORG.set(organization_id)
    try:
        row = sb.get_regulatory_change(str(change_id))
        if not row:
            return {"obligations": 0, "maps": 0, "document_id": None}
        if row.get("lifecycle_status") not in ("queued", "approved"):
            return {"obligations": 0, "maps": 0, "document_id": row.get("document_id")}
        if not row.get("enabled") or row.get("paused"):
            return {"obligations": 0, "maps": 0, "document_id": row.get("document_id")}
        doc_id = row.get("document_id")
        if not doc_id:
            return {"obligations": 0, "maps": 0, "document_id": None}

        sb.merge_regulatory_change(
            str(change_id),
            {"lifecycle_status": "processing", "processing_started_at": sb.now_iso(), "status": "processing"},
        )
        sb.insert_regulation_processing_log(
            organization_id,
            str(change_id),
            "extract",
            "started",
            (row.get("title") or "")[:400],
            agent_name="obligation_extractor",
        )

        departments = sb.list_departments(organization_id) or ["Compliance"]
        title = row.get("title", "Regulatory change")
        raw_summary = (row.get("raw_text") or title) or ""
        regulator = row.get("regulator", "Regulator")
        notification_url = (row.get("url") or "").strip()

        is_cyber = any(kw in f"{title} {raw_summary}".lower() for kw in CYBER_KEYWORDS)
        sec_dept = _security_department(departments) if is_cyber else None

        pdf_bytes = sb.download_document_pdf_bytes(str(doc_id))
        if not pdf_bytes and row.get("manual_pdf_storage_path"):
            pdf_bytes = sb.download_pdf_bytes_from_storage_path(str(row.get("manual_pdf_storage_path")))
        pdf_text = pdf_ingest.extract_text_from_pdf_bytes(pdf_bytes) if pdf_bytes else ""
        needs_ocr = bool(pdf_bytes) and len(pdf_text.strip()) < config.PDF_MIN_TEXT_CHARS
        extraction_text = pdf_text.strip() if pdf_text.strip() else raw_summary
        if needs_ocr and raw_summary:
            extraction_text = f"{pdf_text}\n\n--- Feed summary ---\n{raw_summary}".strip()

        if config.AUTOMATIC_PDF_STRICT and not pdf_bytes and not extraction_text.strip():
            sb.increment_regulatory_retry(str(change_id))
            sb.merge_regulatory_change(
                str(change_id),
                {"lifecycle_status": "failed_processing", "status": "error"},
            )
            sb.insert_regulation_processing_log(
                organization_id,
                str(change_id),
                "extract",
                "failed",
                "No PDF bytes and strict mode / empty text",
                ended_at=sb.now_iso(),
            )
            return {"obligations": 0, "maps": 0, "document_id": str(doc_id)}

        try:
            res = await _run_obligations_maps_phase(
                organization_id,
                departments,
                title,
                extraction_text,
                str(doc_id),
                str(change_id),
                regulator,
                run_id,
                is_cyber=is_cyber,
                sec_dept=sec_dept,
            )
            sb.merge_regulatory_change(
                str(change_id),
                {"lifecycle_status": "completed", "pdf_stage": "chunked"},
            )
            await embed_and_store_regulation_chunks(
                organization_id,
                str(change_id),
                str(doc_id),
                pdf_text or extraction_text,
            )
            sb.insert_regulation_processing_log(
                organization_id,
                str(change_id),
                "extract",
                "completed",
                f"obligations={res['obligations']} maps={res['maps']}",
                ended_at=sb.now_iso(),
            )
            return res
        except Exception as e:
            sb.increment_regulatory_retry(str(change_id))
            sb.merge_regulatory_change(
                str(change_id),
                {"lifecycle_status": "failed_processing", "status": "error"},
            )
            sb.insert_regulation_processing_log(
                organization_id,
                str(change_id),
                "extract",
                "failed",
                str(e)[:2000],
                ended_at=sb.now_iso(),
            )
            sb.log_event(run_id, organization_id, "error", f"process_regulation_extraction: {e}", {"change_id": change_id})
            return {"obligations": 0, "maps": 0, "document_id": str(doc_id)}
    finally:
        CURRENT_ORG.reset(token)


async def process_change(organization_id: str, change: dict[str, Any], run_id: str) -> dict[str, Any]:
    token = CURRENT_ORG.set(organization_id)
    try:
        departments = sb.list_departments(organization_id) or ["Compliance"]
        title = change.get("title", "Regulatory change")
        raw_summary = (change.get("summary") or title) or ""
        change_id = change.get("_id")
        notification_url = change.get("url") or ""
        regulator = change.get("_regulator", change.get("regulator", "Regulator"))

        is_cyber = any(kw in f"{title} {raw_summary}".lower() for kw in CYBER_KEYWORDS)
        sec_dept = _security_department(departments) if is_cyber else None

        strict = config.AUTOMATIC_PDF_STRICT
        pdf_url: str | None = None
        pdf_bytes: bytes | None = None
        pdf_text = ""

        if notification_url.startswith("http"):
            pdf_url = pdf_ingest.resolve_pdf_url(notification_url, regulator)
            if pdf_url:
                try:
                    pdf_bytes = pdf_ingest.download_pdf(pdf_url, referer=notification_url)
                    pdf_text = pdf_ingest.extract_text_from_pdf_bytes(pdf_bytes)
                    sb.log_event(run_id, organization_id, "pdf_resolved", title, {"pdf_url": pdf_url[:500]})
                except Exception as e:
                    if change_id:
                        sb.update_regulatory_change_ingestion(
                            change_id, resolved_pdf_url=pdf_url, ingestion_error=str(e)[:2000]
                        )
                    pdf_bytes = None
                    pdf_text = ""
                    sb.log_event(run_id, organization_id, "pdf_download_failed", str(e)[:480], {})

        use_pdf = bool(pdf_bytes)
        needs_ocr = use_pdf and len(pdf_text.strip()) < config.PDF_MIN_TEXT_CHARS
        extraction_text = pdf_text.strip() if pdf_text.strip() else raw_summary
        if needs_ocr and raw_summary:
            extraction_text = f"{pdf_text}\n\n--- Feed summary ---\n{raw_summary}".strip()

        if strict and not use_pdf:
            if change_id:
                sb.update_regulatory_change_ingestion(
                    change_id,
                    ingestion_error="AUTOMATIC_PDF_STRICT: no PDF could be resolved or downloaded",
                )
                sb.set_change_status(change_id, "error")
            sb.log_event(run_id, organization_id, "error", "strict_pdf_missing", {"title": title})
            sb.write_audit(organization_id, "regulation_detected", title,
                           "Skipped processing: AUTOMATIC_PDF_STRICT and no PDF", severity="warning",
                           metadata={"strict": True}, target_id=change_id)
            return {"obligations": 0, "maps": 0, "document_id": None}

        doc_id: str | None = None
        if use_pdf and change_id and pdf_bytes:
            sha_dup = hashlib.sha256(pdf_bytes).hexdigest()
            existing_doc = sb.find_document_id_by_checksum(organization_id, sha_dup)
            if existing_doc:
                try:
                    sb.set_change_status(str(change_id), "duplicate", existing_doc)
                except Exception:
                    pass
                sb.log_event(
                    run_id,
                    organization_id,
                    "duplicate_pdf_skipped",
                    title,
                    {"document_id": existing_doc},
                )
                return {"obligations": 0, "maps": 0, "document_id": existing_doc}

        if use_pdf and change_id:
            assert pdf_bytes is not None
            doc_id = sb.create_document_from_pdf(
                organization_id,
                title,
                regulator,
                raw_summary[:8000],
                notification_url or None,
                pdf_bytes,
                str(change_id),
                needs_ocr=needs_ocr,
                resolved_pdf_url=pdf_url,
            )
            if doc_id:
                if needs_ocr:
                    sb.log_event(run_id, organization_id, "pdf_needs_ocr", title, {"chars": len(pdf_text)})
                else:
                    sb.log_event(run_id, organization_id, "pdf_ingested", title, {"chars": len(pdf_text)})
            elif strict and change_id:
                sb.update_regulatory_change_ingestion(
                    change_id, ingestion_error="AUTOMATIC_PDF_STRICT: storage or document insert failed"
                )
                sb.set_change_status(change_id, "error")
                sb.write_audit(organization_id, "regulation_detected", title,
                               "Skipped processing: PDF upload or document row failed (strict mode)",
                               severity="warning", metadata={"strict": True}, target_id=change_id)
                return {"obligations": 0, "maps": 0, "document_id": None}

        if not doc_id:
            doc_id = sb.create_document(
                organization_id, title, regulator, raw_summary, change.get("url")
            )

        if not doc_id:
            if change_id:
                sb.set_change_status(change_id, "error")
            return {"obligations": 0, "maps": 0, "document_id": None}

        res = await _run_obligations_maps_phase(
            organization_id,
            departments,
            title,
            extraction_text,
            str(doc_id),
            str(change_id) if change_id else None,
            regulator,
            run_id,
            is_cyber=is_cyber,
            sec_dept=sec_dept,
        )
        return res
    finally:
        CURRENT_ORG.reset(token)


async def run_full(organization_id: str, trigger: str = "manual") -> dict[str, Any]:
    """Watch + process all newly detected changes for one org."""
    run_id = sb.start_run(organization_id, "pipeline", trigger)
    watch = watch_organization(organization_id, trigger)
    totals: dict[str, Any] = {"changes": len(watch["new_changes"]), "obligations": 0, "maps": 0}
    if config.REGULATION_CENTER_ENABLED:
        for change in watch["new_changes"]:
            try:
                await ingest_regulatory_change(organization_id, change, run_id)
            except Exception as e:
                sb.log_event(run_id, organization_id, "error", str(e))
        if config.REGULATION_AUTO_PROCESS:
            max_c = config.MAX_REGULATORY_CHANGES_PER_FULL_RUN
            for _ in range(max_c):
                batch = sb.list_regulation_process_queue(organization_id, limit=1)
                if not batch:
                    break
                cid = str(batch[0]["id"])
                try:
                    res = await process_regulation_extraction(organization_id, cid, run_id)
                    totals["obligations"] += int(res.get("obligations") or 0)
                    totals["maps"] += int(res.get("maps") or 0)
                except Exception as e:
                    sb.log_event(run_id, organization_id, "error", str(e))
    else:
        for change in watch["new_changes"]:
            try:
                res = await process_change(organization_id, change, run_id)
                totals["obligations"] += res["obligations"]
                totals["maps"] += res["maps"]
            except Exception as e:  # keep going on a single bad change
                sb.log_event(run_id, organization_id, "error", str(e))
    sb.finish_run(
        run_id,
        "completed",
        f"Processed {totals['changes']} change(s): {totals['obligations']} obligations, {totals['maps']} MAPs",
        totals,
    )
    return {"run_id": run_id, **totals}


# ── Stage 5: Autonomous evidence validation ───────────────────────────────────

async def run_validator(organization_id: str, trigger: str = "manual") -> dict[str, Any]:
    run_id = sb.start_run(organization_id, "validator", trigger)
    token = CURRENT_ORG.set(organization_id)
    validated, completed = 0, 0
    affected_depts: set[str] = set()
    try:
        cards = sb.open_map_cards_pending_validation(organization_id)
        for card in cards:
            evidence = sb.evidence_for_obligation(organization_id, card.get("obligation_id")) if card.get("obligation_id") else []
            collected = [e for e in evidence if e.get("collected_at")]
            decision_raw = await A.run_agent(
                A.evidence_validator,
                f"MAP: {card.get('title')}\nDue: {card.get('due_date')}\n"
                f"Collected evidence: {[e.get('title') for e in collected]}\n"
                f"Total evidence items: {len(evidence)} (collected: {len(collected)})",
            )
            decision = A.parse_json(decision_raw) or {}
            validated += 1
            if decision.get("complete") and collected:
                sb.update_map_status(card["id"], "completed")
                completed += 1
                if card.get("department"):
                    affected_depts.add(card["department"])
                sb.log_event(run_id, organization_id, "map_validated", card.get("title", ""), {"complete": True})
                sb.write_audit(organization_id, "map_validated", card.get("title", "MAP"),
                               "Agent validated MAP as complete from collected evidence",
                               metadata={"confidence": decision.get("confidence")}, target_id=card["id"])

        # EvidenceAgent -> recompute readiness for departments whose MAPs changed.
        for dept in affected_depts:
            recompute_readiness(organization_id, dept)
            sb.log_event(run_id, organization_id, "readiness_recomputed", dept, {"department": dept})

        sb.finish_run(run_id, "completed", f"Validated {validated} MAP(s), {completed} marked complete",
                      {"validated": validated, "completed": completed, "readiness_recomputed": len(affected_depts)})
        return {"run_id": run_id, "validated": validated, "completed": completed}
    finally:
        CURRENT_ORG.reset(token)


def recompute_readiness(organization_id: str, department: str) -> None:
    """Recompute a department's readiness score from its live obligations + evidence."""
    obs = sb.obligations_for_department(organization_id, department)
    if not obs:
        return
    ev_counts = sb.evidence_count_for_org(organization_id)
    total = len(obs)
    compliant = sum(1 for o in obs if o.get("status") == "compliant")
    overdue = sum(1 for o in obs if o.get("status") == "overdue")
    missing_evidence = sum(1 for o in obs if ev_counts.get(o.get("id"), 0) == 0)
    audit_gaps = sum(1 for o in obs if o.get("status") == "overdue" and o.get("priority") in ("critical", "high"))
    base = (
        (compliant / total) * 60
        + max(0, 1 - overdue / total) * 20
        + max(0, 1 - missing_evidence / total) * 15
        + max(0, 1 - audit_gaps / total) * 5
    )
    score = max(0, min(100, round(base)))
    status = "healthy" if score >= 85 else "warning" if score >= 70 else "at_risk" if score >= 50 else "critical"
    sb.upsert_readiness(organization_id, department, {
        "score": score,
        "max_score": 100,
        "status": status,
        "total_obligations": total,
        "compliant_count": compliant,
        "overdue_count": overdue,
        "missing_evidence": missing_evidence,
        "audit_gaps": audit_gaps,
        "computed_at": sb.now_iso(),
    })


def all_org_ids() -> list[str]:
    res = sb.db().table("organizations").select("id").eq("status", "active").execute()
    return [r["id"] for r in (res.data or [])]


def regulatory_sources_due_for_fetch() -> dict[str, set[str]]:
    """organization_id -> source ids that are due for a feed scan (``fetch_interval_minutes``)."""
    out: dict[str, set[str]] = {}
    now = dt.datetime.now(dt.timezone.utc)
    for s in sb.list_enabled_sources():
        sid = s.get("id")
        oid = s.get("organization_id")
        if not sid or not oid:
            continue
        try:
            mins = max(1, int(s.get("fetch_interval_minutes") or 360))
        except (TypeError, ValueError):
            mins = 360
        last = s.get("last_checked_at") or s.get("last_fetch_attempt_at")
        if not last:
            out.setdefault(str(oid), set()).add(str(sid))
            continue
        lu = _parse_published_dt(str(last))
        if lu is None:
            out.setdefault(str(oid), set()).add(str(sid))
            continue
        delta_min = (now - lu).total_seconds() / 60.0
        if delta_min >= float(mins):
            out.setdefault(str(oid), set()).add(str(sid))
    return out
