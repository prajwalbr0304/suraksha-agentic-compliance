"""Supabase service-role client + small data helpers.

The agent service is multi-tenant aware: every write carries an explicit
organization_id (it uses the service role and therefore bypasses RLS, so tenant
scoping is enforced in code).
"""
from __future__ import annotations

import datetime as dt
import hashlib
from typing import Any, Optional

from supabase import create_client, Client

from . import config

_client: Optional[Client] = None


def db() -> Client:
    global _client
    if _client is None:
        if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not configured")
        _client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    return _client


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


# ── Agent run / event observability ──────────────────────────────────────────

def start_run(organization_id: Optional[str], agent: str, trigger: str = "manual") -> str:
    res = db().table("agent_runs").insert({
        "organization_id": organization_id,
        "agent": agent,
        "trigger": trigger,
        "status": "running",
    }).execute()
    return res.data[0]["id"]


def log_event(run_id: str, organization_id: Optional[str], type_: str, message: str = "", payload: dict | None = None) -> None:
    try:
        db().table("agent_events").insert({
            "run_id": run_id,
            "organization_id": organization_id,
            "type": type_,
            "message": message,
            "payload": payload or {},
        }).execute()
    except Exception:
        pass


def _load_run_stats(run_id: str) -> dict[str, Any]:
    try:
        res = db().table("agent_runs").select("stats").eq("id", run_id).limit(1).execute()
        rows = res.data or []
        if not rows:
            return {}
        s = rows[0].get("stats")
        return dict(s) if isinstance(s, dict) else {}
    except Exception:
        return {}


def merge_run_stats(run_id: str, patch: dict[str, Any]) -> None:
    """Merge ``patch`` into ``agent_runs.stats`` (for live pipeline progress)."""
    if not patch:
        return
    try:
        base = _load_run_stats(run_id)
        base.update(patch)
        db().table("agent_runs").update({"stats": base}).eq("id", run_id).execute()
    except Exception:
        pass


def finish_run(run_id: str, status: str, summary: str, stats: dict | None = None) -> None:
    merged = _load_run_stats(run_id)
    if stats:
        merged.update(stats)
    db().table("agent_runs").update({
        "status": status,
        "summary": summary,
        "stats": merged,
        "finished_at": now_iso(),
    }).eq("id", run_id).execute()


def write_audit(organization_id: Optional[str], action: str, target: str, details: str,
                severity: str = "info", metadata: dict | None = None, target_id: str | None = None) -> None:
    try:
        db().table("audit_trail").insert({
            "action": action,
            "actor": "ai-agent@suraksha",
            "actor_role": "platform_admin",
            "target": target,
            "target_id": target_id,
            "details": details,
            "severity": severity,
            "metadata": metadata or {},
            "organization_id": organization_id,
        }).execute()
    except Exception:
        pass


# ── Domain helpers ───────────────────────────────────────────────────────────

def list_enabled_sources() -> list[dict[str, Any]]:
    res = db().table("regulatory_sources").select("*").eq("enabled", True).execute()
    return res.data or []


def touch_regulatory_source_fetch(source_id: str, ok: bool, error: str | None = None) -> None:
    """Update fetch health columns after a probe or watch scan."""
    now = now_iso()
    try:
        if ok:
            db().table("regulatory_sources").update({
                "last_fetch_attempt_at": now,
                "last_fetch_success_at": now,
                "last_fetch_error": None,
                "last_checked_at": now,
            }).eq("id", source_id).execute()
        else:
            db().table("regulatory_sources").update({
                "last_fetch_attempt_at": now,
                "last_fetch_error": (error or "fetch_failed")[:2000],
                "last_checked_at": now,
            }).eq("id", source_id).execute()
    except Exception:
        pass


def list_departments(organization_id: str) -> list[str]:
    res = db().table("departments").select("name").eq("organization_id", organization_id).execute()
    return [r["name"] for r in (res.data or [])]


def change_exists(organization_id: str, external_ref: str) -> bool:
    res = db().table("regulatory_changes").select("id").eq("organization_id", organization_id).eq("external_ref", external_ref).limit(1).execute()
    return bool(res.data)


def insert_change(organization_id: str, source_id: str | None, regulator: str, change: dict) -> Optional[str]:
    try:
        res = db().table("regulatory_changes").insert({
            "organization_id": organization_id,
            "source_id": source_id,
            "regulator": regulator,
            "external_ref": change["external_ref"],
            "title": change["title"],
            "url": change.get("url"),
            "published_at": change.get("published_at"),
            "raw_text": change.get("summary"),
            "status": "detected",
            "lifecycle_status": "new",
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def find_document_id_by_checksum(organization_id: str, checksum_sha256: str) -> Optional[str]:
    if not checksum_sha256:
        return None
    try:
        res = (
            db()
            .table("documents")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("checksum_sha256", checksum_sha256)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return str(rows[0]["id"]) if rows else None
    except Exception:
        return None


def obligation_fingerprint_exists(organization_id: str, fingerprint: str) -> bool:
    if not fingerprint:
        return False
    try:
        res = (
            db()
            .table("obligations")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("obligation_fingerprint", fingerprint)
            .limit(1)
            .execute()
        )
        return bool(res.data)
    except Exception:
        return False


def set_change_status(change_id: str, status: str, document_id: str | None = None) -> None:
    payload: dict[str, Any] = {"status": status}
    if document_id:
        payload["document_id"] = document_id
    lifecycle_map = {
        "mapped": "completed",
        "error": "failed_processing",
        "duplicate": "duplicate",
        "processing": "processing",
        "detected": "new",
    }
    if status in lifecycle_map:
        payload["lifecycle_status"] = lifecycle_map[status]
    try:
        db().table("regulatory_changes").update(payload).eq("id", change_id).execute()
    except Exception:
        pass


def merge_regulatory_change(change_id: str, patch: dict[str, Any]) -> None:
    if not patch:
        return
    try:
        db().table("regulatory_changes").update(patch).eq("id", change_id).execute()
    except Exception:
        pass


def get_regulatory_change(change_id: str) -> dict[str, Any] | None:
    try:
        res = db().table("regulatory_changes").select("*").eq("id", change_id).limit(1).execute()
        rows = res.data or []
        return dict(rows[0]) if rows else None
    except Exception:
        return None


def get_regulatory_source(source_id: str) -> dict[str, Any] | None:
    try:
        res = db().table("regulatory_sources").select("*").eq("id", source_id).limit(1).execute()
        rows = res.data or []
        return dict(rows[0]) if rows else None
    except Exception:
        return None


def link_change_document(change_id: str, document_id: str) -> None:
    try:
        db().table("regulatory_changes").update({"document_id": document_id}).eq("id", change_id).execute()
    except Exception:
        pass


def find_regulatory_duplicate_by_checksum(organization_id: str, checksum: str, exclude_change_id: str | None = None) -> Optional[str]:
    if not checksum:
        return None
    try:
        q = (
            db()
            .table("regulatory_changes")
            .select("id")
            .eq("organization_id", organization_id)
            .eq("pdf_checksum_sha256", checksum)
            .limit(5)
            .execute()
        )
        for row in q.data or []:
            rid = str(row["id"])
            if exclude_change_id and rid == exclude_change_id:
                continue
            return rid
        return None
    except Exception:
        return None


def next_regulation_processing_order(organization_id: str) -> int:
    try:
        res = (
            db()
            .table("regulatory_changes")
            .select("processing_order")
            .eq("organization_id", organization_id)
            .not_.is_("processing_order", "null")
            .order("processing_order", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return 1
        v = rows[0].get("processing_order")
        return int(v) + 1 if v is not None else 1
    except Exception:
        return 1


def list_undownloaded_changes(
    organization_id: str,
    source_ids_filter: set[str] | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Detected changes that still have no downloaded PDF (document_id is null).

    Used by the ``download`` pipeline so the Download/Monitor buttons can fetch
    PDFs for items that were previously only *detected* (lifecycle new /
    awaiting_approval / failed_ingest). ``source_ids_filter`` restricts to
    specific ``regulatory_sources`` ids.
    """
    try:
        q = (
            db()
            .table("regulatory_changes")
            .select("*")
            .eq("organization_id", organization_id)
            .in_("lifecycle_status", ["new", "awaiting_approval", "failed_ingest"])
            .is_("document_id", "null")
            .order("created_at", desc=True)
            .limit(max(limit, 1))
        )
        res = q.execute()
        rows = [dict(r) for r in (res.data or [])]
        if source_ids_filter is not None:
            rows = [r for r in rows if str(r.get("source_id") or "") in source_ids_filter]
        return rows
    except Exception:
        return []


def reclaim_stuck_processing(organization_id: str, older_than_minutes: int = 20) -> int:
    """Requeue regulations stuck in 'processing' (e.g. agent restarted mid-extraction).

    Without this, a change whose extraction was interrupted stays 'processing' forever and
    the queue (which excludes 'processing') silently skips it.
    """
    try:
        cutoff = (
            dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=max(1, older_than_minutes))
        ).isoformat()
        res = (
            db()
            .table("regulatory_changes")
            .select("id,processing_started_at")
            .eq("organization_id", organization_id)
            .eq("lifecycle_status", "processing")
            .execute()
        )
        ids = []
        for r in res.data or []:
            started = r.get("processing_started_at")
            if not started or started < cutoff:
                ids.append(r["id"])
        for cid in ids:
            db().table("regulatory_changes").update(
                {"lifecycle_status": "queued", "status": "detected"}
            ).eq("id", cid).execute()
        return len(ids)
    except Exception:
        return 0


def list_regulation_process_queue(organization_id: str, limit: int = 10) -> list[dict[str, Any]]:
    try:
        res = (
            db()
            .table("regulatory_changes")
            .select("*")
            .eq("organization_id", organization_id)
            .in_("lifecycle_status", ["queued", "approved"])
            .eq("enabled", True)
            .eq("paused", False)
            .not_.is_("document_id", "null")
            .limit(max(limit * 3, 15))
            .execute()
        )
        rows = [dict(r) for r in (res.data or [])]

        def _sort_key(r: dict[str, Any]) -> tuple:
            po = r.get("processing_order")
            qd = r.get("queued_at") or r.get("approved_at") or ""
            return (po is None, po or 0, qd)

        rows.sort(key=_sort_key)
        return rows[:limit]
    except Exception:
        return []


def insert_regulation_processing_log(
    organization_id: str,
    regulatory_change_id: str,
    stage: str,
    status: str,
    message: str = "",
    *,
    agent_name: str | None = None,
    payload: dict[str, Any] | None = None,
    ended_at: str | None = None,
) -> None:
    try:
        row: dict[str, Any] = {
            "organization_id": organization_id,
            "regulatory_change_id": regulatory_change_id,
            "stage": stage,
            "status": status,
            "message": (message or "")[:4000],
            "agent_name": agent_name,
            "payload": payload or {},
            "started_at": now_iso(),
        }
        if ended_at:
            row["ended_at"] = ended_at
        db().table("regulation_processing_log").insert(row).execute()
    except Exception:
        pass


def update_source_watermark(source_id: str, published_at_iso: str | None) -> None:
    if not source_id or not published_at_iso:
        return
    try:
        db().table("regulatory_sources").update({"fetch_watermark_published_at": published_at_iso}).eq("id", source_id).execute()
    except Exception:
        pass


def update_source_watermark_max(source_id: str, candidate_iso: str | None) -> None:
    """Advance fetch watermark to the later of the current DB value and ``candidate_iso``."""
    if not source_id or not candidate_iso:
        return
    try:
        row = get_regulatory_source(source_id)
        cur = (row or {}).get("fetch_watermark_published_at")
        if cur:
            t_cur = _parse_iso_dt(cur)
            t_new = _parse_iso_dt(candidate_iso)
            if t_cur and t_new and t_new <= t_cur:
                return
        db().table("regulatory_sources").update({"fetch_watermark_published_at": candidate_iso}).eq("id", source_id).execute()
    except Exception:
        pass


def _parse_iso_dt(iso: str) -> dt.datetime | None:
    if not iso or not isinstance(iso, str):
        return None
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=dt.timezone.utc)
        return t
    except Exception:
        return None


def download_pdf_bytes_from_storage_path(storage_path: str) -> Optional[bytes]:
    if not storage_path:
        return None
    try:
        bucket = config.DOCUMENTS_BUCKET
        data = db().storage.from_(bucket).download(storage_path)
        return data if isinstance(data, (bytes, bytearray)) else bytes(data)
    except Exception:
        return None


def increment_regulatory_retry(change_id: str) -> None:
    try:
        row = get_regulatory_change(change_id)
        n = int((row or {}).get("retry_count") or 0) + 1
        merge_regulatory_change(change_id, {"retry_count": n})
    except Exception:
        pass


def delete_document_chunks_for_document(document_id: str) -> None:
    try:
        db().table("document_chunks").delete().eq("document_id", document_id).execute()
    except Exception:
        pass


def insert_document_chunk_row(row: dict[str, Any]) -> None:
    try:
        db().table("document_chunks").insert(row).execute()
    except Exception:
        pass


def get_document(document_id: str) -> dict[str, Any] | None:
    try:
        res = db().table("documents").select("*").eq("id", document_id).limit(1).execute()
        rows = res.data or []
        return dict(rows[0]) if rows else None
    except Exception:
        return None


def download_document_pdf_bytes(document_id: str) -> Optional[bytes]:
    """Download PDF bytes from compliance-documents bucket using documents.storage_path."""
    doc = get_document(document_id)
    if not doc:
        return None
    path = doc.get("storage_path")
    if not path:
        return None
    try:
        bucket = config.DOCUMENTS_BUCKET
        data = db().storage.from_(bucket).download(path)
        return data if isinstance(data, (bytes, bytearray)) else bytes(data)
    except Exception:
        return None


def update_regulatory_change_ingestion(
    change_id: str,
    *,
    resolved_pdf_url: str | None = None,
    pdf_storage_path: str | None = None,
    ingestion_error: str | None = None,
    clear_ingestion_error: bool = False,
) -> None:
    """Optional columns from migration 023; apply migration 023 before relying on these updates."""
    payload: dict[str, Any] = {}
    if resolved_pdf_url is not None:
        payload["resolved_pdf_url"] = resolved_pdf_url
    if pdf_storage_path is not None:
        payload["pdf_storage_path"] = pdf_storage_path
    if ingestion_error is not None:
        payload["ingestion_error"] = ingestion_error
    if clear_ingestion_error:
        payload["ingestion_error"] = None
    if not payload:
        return
    try:
        db().table("regulatory_changes").update(payload).eq("id", change_id).execute()
    except Exception:
        pass


def create_document_from_pdf(
    organization_id: str,
    name: str,
    regulation_name: str,
    summary: str,
    source_url: str | None,
    pdf_bytes: bytes,
    change_id: str,
    *,
    needs_ocr: bool = False,
    resolved_pdf_url: str | None = None,
) -> Optional[str]:
    """Upload PDF to storage, insert documents row, return document id."""
    try:
        bucket = config.DOCUMENTS_BUCKET
        safe_name = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:80]
        storage_path = f"agent-pdf/{organization_id}/{change_id}-{safe_name}.pdf"
        sha = hashlib.sha256(pdf_bytes).hexdigest()
        existing = find_document_id_by_checksum(organization_id, sha)
        if existing:
            try:
                update_regulatory_change_ingestion(
                    change_id,
                    resolved_pdf_url=resolved_pdf_url or source_url,
                    clear_ingestion_error=True,
                )
                set_change_status(change_id, "duplicate", existing)
            except Exception:
                pass
            return existing
        sto = db().storage.from_(bucket)
        sto.upload(
            storage_path,
            pdf_bytes,
            file_options={"content-type": "application/pdf", "upsert": True},
        )
        meta: dict[str, Any] = {
            "source": "agent",
            "ingestion": "automatic_pdf",
            "url": source_url,
            "resolved_pdf_url": resolved_pdf_url,
            "needs_ocr": needs_ocr,
            "checksum_sha256": sha,
        }
        res = db().table("documents").insert({
            "name": name[:500],
            "size": len(pdf_bytes),
            "mime_type": "application/pdf",
            "storage_path": storage_path,
            "status": "processed",
            "regulation_name": regulation_name,
            "summary": summary[:8000] if summary else "",
            "uploaded_by": "ai-agent@suraksha",
            "processed_at": now_iso(),
            "organization_id": organization_id,
            "metadata": meta,
            "checksum_sha256": sha,
            "obligations_extracted": 0,
            "confidence_score": 0,
        }).execute()
        doc_id = res.data[0]["id"]
        update_regulatory_change_ingestion(
            change_id,
            resolved_pdf_url=resolved_pdf_url or source_url,
            pdf_storage_path=storage_path,
            clear_ingestion_error=True,
        )
        link_change_document(change_id, doc_id)
        merge_regulatory_change(change_id, {"pdf_checksum_sha256": sha})
        return doc_id
    except Exception:
        return None


def create_document(organization_id: str, name: str, regulation_name: str, summary: str, url: str | None) -> Optional[str]:
    try:
        res = db().table("documents").insert({
            "name": name,
            "size": len(summary or ""),
            "mime_type": "text/html",
            "storage_path": f"agent/{organization_id}/{name}-{dt.datetime.now().timestamp()}",
            "status": "processed",
            "regulation_name": regulation_name,
            "summary": summary,
            "uploaded_by": "ai-agent@suraksha",
            "processed_at": now_iso(),
            "organization_id": organization_id,
            "metadata": {"source": "agent", "url": url},
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def insert_obligation(organization_id: str, document_id: str | None, ob: dict) -> Optional[str]:
    try:
        ref = f"AGENT-{dt.datetime.now().timestamp()}"
        row: dict[str, Any] = {
            "reference": ref,
            "title": ob["title"][:300],
            "description": ob.get("description", ""),
            "regulation": ob.get("regulation", "Regulatory Circular"),
            "jurisdiction": "India",
            "department": ob.get("department", "Compliance"),
            "owner": "AI Agent",
            "status": "in_progress",
            "priority": ob.get("priority", "medium"),
            # obligations.due_date is NOT NULL; the obligation extractor doesn't emit a date,
            # so default to 30 days out when absent (prevents silent insert failures -> 0 obligations).
            "due_date": ob.get("due_date") or (dt.date.today() + dt.timedelta(days=30)).isoformat(),
            "confidence_score": ob.get("confidence", 80),
            "citation": ob.get("citation"),
            "compliance_risk": ob.get("risk", "medium"),
            "document_id": document_id,
            "organization_id": organization_id,
            "review_status": "pending",
            "source": "agent",
        }
        fp = ob.get("obligation_fingerprint")
        if fp:
            row["obligation_fingerprint"] = str(fp)[:128]
        res = db().table("obligations").insert(row).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def insert_map_card(organization_id: str, obligation_id: str, m: dict) -> Optional[str]:
    try:
        res = db().table("map_cards").insert({
            "title": m["title"][:300],
            "obligation_id": obligation_id,
            "owner": m.get("owner", "Department Lead"),
            "due_date": m.get("due_date"),
            "status": "pending_approval",
            "priority": m.get("priority", "medium"),
            "department": m.get("department"),
            "organization_id": organization_id,
            "generated_by": "ai",
        }).execute()
        map_id = res.data[0]["id"]
        title = m["title"][:300]
        append_map_activity(
            organization_id,
            map_id,
            event_type="map_created",
            summary=f"MAP created (AI pipeline): {title[:200]}",
            metadata={
                "obligation_id": obligation_id,
                "status": "pending_approval",
                "source": "agent",
            },
        )
        return map_id
    except Exception:
        return None


def append_map_activity(
    organization_id: str,
    map_card_id: str,
    *,
    event_type: str,
    summary: str,
    metadata: dict[str, Any] | None = None,
    actor_user_id: str | None = None,
) -> None:
    """Best-effort timeline row; ignores failures (e.g. table not migrated)."""
    try:
        db().table("map_activity").insert({
            "organization_id": organization_id,
            "map_card_id": map_card_id,
            "actor_user_id": actor_user_id,
            "event_type": event_type,
            "summary": (summary or "")[:500],
            "metadata": metadata or {},
        }).execute()
    except Exception:
        pass


def open_map_cards(organization_id: str) -> list[dict[str, Any]]:
    res = (
        db()
        .table("map_cards")
        .select("id, title, status, due_date, obligation_id, department")
        .eq("organization_id", organization_id)
        .not_.in_("status", ["completed", "rejected", "archived"])
        .execute()
    )
    return res.data or []


def open_map_cards_pending_validation(organization_id: str) -> list[dict[str, Any]]:
    """MAPs waiting on evidence validation (human moved to under review, or legacy review)."""
    res = (
        db()
        .table("map_cards")
        .select("id, title, status, due_date, obligation_id, department")
        .eq("organization_id", organization_id)
        .in_("status", ["under_review", "review"])
        .execute()
    )
    return res.data or []


def evidence_for_obligation(organization_id: str, obligation_id: str) -> list[dict[str, Any]]:
    res = db().table("evidence").select("id, title, collected_at").eq("organization_id", organization_id).eq("obligation_id", obligation_id).execute()
    return res.data or []


def update_map_status(map_id: str, status: str) -> None:
    org_id: str | None = None
    prev: str | None = None
    try:
        sel = db().table("map_cards").select("organization_id, status").eq("id", map_id).limit(1).execute()
        if sel.data:
            org_id = sel.data[0].get("organization_id")
            prev = sel.data[0].get("status")
    except Exception:
        pass
    try:
        db().table("map_cards").update({"status": status, "updated_at": now_iso()}).eq("id", map_id).execute()
    except Exception:
        return
    if org_id and prev is not None and prev != status:
        append_map_activity(
            org_id,
            map_id,
            event_type="status_changed",
            summary=f"Status changed from {prev} to {status}",
            metadata={"previous_status": prev, "status": status, "source": "agent"},
        )


# ── Routing / escalation ──────────────────────────────────────────────────────

def insert_escalation(organization_id: str, *, obligation_id: str | None, map_card_id: str | None,
                      escalated_to: str, reason: str, severity: str = "high") -> Optional[str]:
    try:
        res = db().table("escalations").insert({
            "organization_id": organization_id,
            "obligation_id": obligation_id,
            "map_card_id": map_card_id,
            "escalated_to": escalated_to,
            "reason": reason,
            "severity": severity if severity in ("critical", "high", "medium", "low") else "high",
            "status": "open",
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


# ── Readiness (recompute from live obligations + evidence) ────────────────────

def obligations_for_department(organization_id: str, department: str) -> list[dict[str, Any]]:
    res = db().table("obligations").select("id, status, priority, due_date").eq(
        "organization_id", organization_id).eq("department", department).execute()
    return res.data or []


def evidence_count_for_org(organization_id: str) -> dict[str, int]:
    res = db().table("evidence").select("obligation_id, collected_at").eq("organization_id", organization_id).execute()
    counts: dict[str, int] = {}
    for e in (res.data or []):
        if e.get("collected_at"):
            counts[e["obligation_id"]] = counts.get(e["obligation_id"], 0) + 1
    return counts


def upsert_readiness(organization_id: str, department: str, payload: dict) -> None:
    """readiness_scores has no unique constraint; delete this org+dept row then insert."""
    try:
        db().table("readiness_scores").delete().eq("organization_id", organization_id).eq("department", department).execute()
        db().table("readiness_scores").insert({**payload, "organization_id": organization_id, "department": department}).execute()
    except Exception:
        pass


# ── Drift / Impact / Audit export ─────────────────────────────────────────────

def recent_documents(organization_id: str, limit: int = 5) -> list[dict[str, Any]]:
    # documents table uses uploaded_at (no created_at); see 001_core_schema.sql
    res = db().table("documents").select("id, name, regulation_name, summary, uploaded_at").eq(
        "organization_id", organization_id).order("uploaded_at", desc=True).limit(limit).execute()
    return res.data or []


def insert_drift(organization_id: str, base_doc_id: str | None, new_doc_id: str | None, payload: dict) -> Optional[str]:
    try:
        res = db().table("drift_comparisons").insert({
            "organization_id": organization_id,
            "base_doc_id": base_doc_id,
            "new_doc_id": new_doc_id,
            "status": "completed",
            "summary": payload.get("summary"),
            "new_obligations": payload.get("new_obligations", 0),
            "removed_obligations": payload.get("removed_obligations", 0),
            "changed_obligations": payload.get("changed_obligations", 0),
            "drift_score": payload.get("drift_score", 0),
            "changes_json": payload.get("changes", []),
            "completed_at": now_iso(),
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def insert_impact(organization_id: str, document_id: str | None, payload: dict) -> Optional[str]:
    try:
        res = db().table("impact_simulations").insert({
            "organization_id": organization_id,
            "document_id": document_id,
            "regulation_name": payload.get("regulation_name"),
            "impacted_teams": payload.get("impacted_teams", []),
            "risk_level": payload.get("risk_level", "medium"),
            "audit_risk": payload.get("audit_risk", "medium"),
            "operational_risk": payload.get("operational_risk", "medium"),
            "complexity": payload.get("complexity", "medium"),
            "estimated_weeks": payload.get("estimated_weeks", 4),
            "summary": payload.get("summary"),
            "affected_controls": payload.get("affected_controls", []),
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def insert_audit_export(organization_id: str, export_type: str, filters: dict, summary: str) -> Optional[str]:
    try:
        res = db().table("audit_exports").insert({
            "organization_id": organization_id,
            "export_type": export_type,
            "filters": {**filters, "summary": summary},
            "status": "completed",
            "completed_at": now_iso(),
        }).execute()
        return res.data[0]["id"]
    except Exception:
        return None


def recent_agent_events(organization_id: str, limit: int = 50) -> list[dict[str, Any]]:
    res = db().table("agent_events").select("type, message, created_at").eq(
        "organization_id", organization_id).order("created_at", desc=True).limit(limit).execute()
    return res.data or []
