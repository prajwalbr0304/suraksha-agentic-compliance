"""CoordinatorAgent: the formal multi-agent orchestrator (Google ADK / Gemini).

The Coordinator owns a single parent ``agent_runs`` row (agent="coordinator") and
dispatches the named sub-agents, attributing a child ``agent_events`` row to each:

    Coordinator
      ├── MonitoringAgent   -> regulatory_changes      (pipeline.watch_organization)
      ├── ObligationAgent   -> obligations             (pipeline.process_change)
      ├── MapAgent          -> map_cards               (pipeline.process_change)
      ├── RoutingAgent      -> map_cards / escalations  (pipeline.process_change)
      ├── EvidenceAgent     -> map_cards / readiness    (pipeline.run_validator)
      ├── DriftAgent        -> drift_comparisons
      ├── ImpactAgent       -> impact_simulations
      └── AuditAgent        -> audit_trail / audit_exports

Sub-stages that are themselves substantial (monitoring, validation) keep their own
named ``agent_runs`` for granular observability; lighter stages log events on the
parent coordinator run.

Live UI progress: ``merge_run_stats`` on the coordinator row sets
``pipeline_stage_index`` (0..n-1), ``pipeline_stage_key``, ``pipeline_stage_label``.
HTTP ``POST /runs`` for ``full`` and ``validate`` returns 202 immediately and runs
work in a FastAPI ``BackgroundTasks`` handler so the Next.js app can poll
``agent_runs`` for the same ``run_id``.
"""
from __future__ import annotations

import asyncio
from typing import Any

from . import agents as A
from . import config
from . import pipeline
from . import supabase_client as sb
from .tools import CURRENT_ORG


def _stage(run_id: str, index: int, key: str, label: str, pipeline: str = "full") -> None:
    sb.merge_run_stats(run_id, {
        "pipeline": pipeline,
        "pipeline_stage_index": index,
        "pipeline_stage_key": key,
        "pipeline_stage_label": label,
        "pipeline_failed_stage_index": None,
        "pipeline_error_message": None,
    })


async def _run_drift(organization_id: str, run_id: str) -> int:
    docs = sb.recent_documents(organization_id, limit=2)
    if len(docs) < 2:
        return 0
    new_doc, base_doc = docs[0], docs[1]
    raw = await A.run_agent(
        A.drift_analyzer,
        f"BASE circular:\n{base_doc.get('regulation_name')}: {base_doc.get('summary')}\n\n"
        f"NEW circular:\n{new_doc.get('regulation_name')}: {new_doc.get('summary')}",
    )
    data = A.parse_json(raw) or {}
    sb.insert_drift(organization_id, base_doc.get("id"), new_doc.get("id"), data)
    sb.log_event(run_id, organization_id, "sub_agent", "DriftAgent: drift comparison recorded",
                 {"agent": "drift_analyzer", "drift_score": data.get("drift_score")})
    return 1


async def _run_impact(organization_id: str, run_id: str) -> int:
    docs = sb.recent_documents(organization_id, limit=1)
    if not docs:
        return 0
    doc = docs[0]
    token = CURRENT_ORG.set(organization_id)
    try:
        raw = await A.run_agent(
            A.impact_assessor,
            f"Regulation: {doc.get('regulation_name')}\nSummary: {doc.get('summary')}",
        )
    finally:
        CURRENT_ORG.reset(token)
    data = A.parse_json(raw) or {}
    data.setdefault("regulation_name", doc.get("regulation_name"))
    sb.insert_impact(organization_id, doc.get("id"), data)
    sb.log_event(run_id, organization_id, "sub_agent", "ImpactAgent: impact simulation recorded",
                 {"agent": "impact_assessor", "risk_level": data.get("risk_level")})
    return 1


async def _run_audit(organization_id: str, run_id: str) -> None:
    events = sb.recent_agent_events(organization_id, limit=25)
    raw = await A.run_agent(
        A.audit_summarizer,
        "Recent compliance automation events:\n"
        + "\n".join(f"- {e.get('type')}: {e.get('message')}" for e in events),
    )
    data = A.parse_json(raw) or {}
    summary = data.get("summary") or "Automated compliance activity summary."
    sb.insert_audit_export(organization_id, "agent_activity",
                           {"highlights": data.get("highlights", []), "risks": data.get("risks", [])}, summary)
    sb.write_audit(organization_id, "agent_run", "AuditAgent", summary,
                   metadata={"highlights": data.get("highlights", []), "risks": data.get("risks", [])})
    sb.log_event(run_id, organization_id, "sub_agent", "AuditAgent: audit summary generated",
                 {"agent": "audit_summarizer"})


async def execute_coordinator_full(organization_id: str, run_id: str, trigger: str) -> dict[str, Any]:
    """Run the full coordinator pipeline for an existing ``run_id`` (already inserted)."""
    sb.log_event(run_id, organization_id, "coordinator", "Coordinator dispatching sub-agents",
                 {"sub_agents": [a["name"] for a in A.SUB_AGENTS]})
    totals: dict[str, Any] = {"changes": 0, "obligations": 0, "maps": 0, "drift": 0, "impact": 0, "deferred": 0}
    try:
        _stage(run_id, 0, "monitoring", "Monitoring regulatory feeds…", "full")
        sb.log_event(run_id, organization_id, "sub_agent", "MonitoringAgent: scanning regulatory feeds",
                     {"agent": "monitoring_agent"})
        watch = pipeline.watch_organization(organization_id, trigger, parent_run_id=run_id)
        changes_all = watch["new_changes"] or []
        totals["changes"] = len(changes_all)

        max_c = config.MAX_REGULATORY_CHANGES_PER_FULL_RUN
        to_process = changes_all[:max_c]
        deferred_n = max(0, len(changes_all) - max_c)
        if deferred_n:
            sb.log_event(
                run_id,
                organization_id,
                "info",
                f"Processing {max_c} of {len(changes_all)} new change(s) this run; {deferred_n} deferred to a later run.",
                {"processed": max_c, "deferred": deferred_n},
            )
        sb.merge_run_stats(
            run_id,
            {
                "queue_deferred_regulatory_changes": deferred_n,
                "queue_detected_new_changes": len(changes_all),
                "queue_processing_slots": len(to_process),
            },
        )

        if not to_process:
            sb.merge_run_stats(run_id, {
                "pipeline_stage_index": 3,
                "pipeline_stage_key": "idle",
                "pipeline_stage_label": "No new changes — skipping extraction…",
            })
            sb.log_event(
                run_id, organization_id, "info",
                "No new regulatory_changes in this scan — obligation/MAP extraction only runs for newly detected feed items. "
                "Re-run after new RSS items appear, or enable SURAKSHA_REGULATORY_FEED_SAMPLES for offline demos.",
                {"new_changes": 0},
            )

        if config.REGULATION_CENTER_ENABLED:
            _stage(run_id, 1, "ingest", "Ingesting PDFs (Regulation Center)…", "full")
            for change in to_process:
                try:
                    await pipeline.ingest_regulatory_change(organization_id, change, run_id)
                except Exception as e:
                    sb.log_event(
                        run_id, organization_id, "error",
                        f"ingest_regulatory_change failed: {e}",
                        {"change_title": change.get("title"), "error": str(e)[:2000]},
                    )
            if config.REGULATION_AUTO_PROCESS:
                _stage(run_id, 2, "queue", "Processing regulation queue…", "full")
                for _ in range(max_c):
                    batch = sb.list_regulation_process_queue(organization_id, limit=1)
                    if not batch:
                        break
                    cid = str(batch[0]["id"])
                    try:
                        res = await pipeline.process_regulation_extraction(organization_id, cid, run_id)
                        totals["obligations"] += int(res.get("obligations") or 0)
                        totals["maps"] += int(res.get("maps") or 0)
                    except Exception as e:
                        sb.log_event(
                            run_id, organization_id, "error",
                            f"process_regulation_extraction failed: {e}",
                            {"change_id": cid, "error": str(e)[:2000]},
                        )
        else:
            for change in to_process:
                try:
                    res = await pipeline.process_change(organization_id, change, run_id)
                    totals["obligations"] += res["obligations"]
                    totals["maps"] += res["maps"]
                except Exception as e:  # keep going on a single bad change
                    sb.log_event(
                        run_id, organization_id, "error",
                        f"process_change failed: {e}",
                        {"change_title": change.get("title"), "error": str(e)[:2000]},
                    )

        _stage(run_id, 4, "drift_impact", "Drift & impact analysis…", "full")

        async def _safe_drift() -> int:
            try:
                return await _run_drift(organization_id, run_id)
            except Exception as e:
                sb.log_event(run_id, organization_id, "error", f"DriftAgent: {e}")
                return 0

        async def _safe_impact() -> int:
            try:
                return await _run_impact(organization_id, run_id)
            except Exception as e:
                sb.log_event(run_id, organization_id, "error", f"ImpactAgent: {e}")
                return 0

        drift_n, impact_n = await asyncio.gather(_safe_drift(), _safe_impact())
        totals["drift"] = drift_n
        totals["impact"] = impact_n
        totals["deferred"] = deferred_n

        _stage(run_id, 5, "audit", "Recording audit summary…", "full")
        try:
            await _run_audit(organization_id, run_id)
        except Exception as e:
            sb.log_event(run_id, organization_id, "error", f"AuditAgent: {e}")

        sb.finish_run(
            run_id, "completed",
            f"Coordinator: {totals['changes']} change(s), {totals['obligations']} obligations, "
            f"{totals['maps']} MAPs, {totals['drift']} drift, {totals['impact']} impact",
            totals,
        )
        return {"run_id": run_id, **totals}
    except Exception as e:
        sb.merge_run_stats(run_id, {"pipeline_error_message": str(e)[:1500]})
        sb.finish_run(run_id, "failed", f"Coordinator error: {e}", totals)
        return {"run_id": run_id, "error": str(e), **totals}


async def run_full(organization_id: str, trigger: str = "manual") -> dict[str, Any]:
    """Full pipeline (blocking): used by the scheduler and tests."""
    run_id = sb.start_run(organization_id, "coordinator", trigger)
    sb.merge_run_stats(run_id, {"pipeline": "full"})
    return await execute_coordinator_full(organization_id, run_id, trigger)


async def run_full_background(organization_id: str, run_id: str, trigger: str) -> None:
    """Fire-and-forget entry for FastAPI ``BackgroundTasks`` (HTTP already returned 202)."""
    try:
        await execute_coordinator_full(organization_id, run_id, trigger)
    except Exception as e:
        print(f"[coordinator] run_full_background: {e}")


async def execute_coordinator_validate(organization_id: str, run_id: str, trigger: str) -> dict[str, Any]:
    """Validate pipeline for an existing coordinator ``run_id``."""
    res: dict[str, Any] = {"validated": 0, "completed": 0}
    fail_stage = 0
    try:
        _stage(run_id, 0, "loading", "Loading open MAPs…", "validate")
        sb.log_event(run_id, organization_id, "sub_agent", "EvidenceAgent: validating open MAPs",
                     {"agent": "evidence_validator"})
        fail_stage = 1
        _stage(run_id, 1, "validating", "Validating compliance evidence…", "validate")
        res = await pipeline.run_validator(organization_id, trigger)
        fail_stage = 2
        _stage(run_id, 2, "map_status", "Updating MAP completion status…", "validate")
        fail_stage = 3
        _stage(run_id, 3, "readiness", "Recomputing readiness scores…", "validate")
        fail_stage = 4
        _stage(run_id, 4, "audit", "Recording audit summary…", "validate")
        try:
            await _run_audit(organization_id, run_id)
        except Exception as e:
            sb.log_event(run_id, organization_id, "error", f"AuditAgent: {e}")
        sb.finish_run(
            run_id, "completed",
            f"Coordinator validate: {res.get('validated')} validated, {res.get('completed')} completed",
            res,
        )
        return {"run_id": run_id, **res}
    except Exception as e:
        sb.merge_run_stats(run_id, {
            "pipeline_failed_stage_index": fail_stage,
            "pipeline_error_message": str(e)[:1500],
        })
        sb.finish_run(run_id, "failed", f"Coordinator validate error: {e}", res)
        return {"run_id": run_id, "error": str(e), **res}


async def run_validate(organization_id: str, trigger: str = "manual") -> dict[str, Any]:
    """Validate sweep (blocking): scheduler and tests."""
    run_id = sb.start_run(organization_id, "coordinator", trigger)
    sb.merge_run_stats(run_id, {"pipeline": "validate"})
    return await execute_coordinator_validate(organization_id, run_id, trigger)


async def run_validate_background(organization_id: str, run_id: str, trigger: str) -> None:
    try:
        await execute_coordinator_validate(organization_id, run_id, trigger)
    except Exception as e:
        print(f"[coordinator] run_validate_background: {e}")


def run_watch(organization_id: str, trigger: str = "manual") -> dict[str, Any]:
    """MonitoringAgent only (synchronous feed scan). Used by tests and inline callers."""
    return pipeline.watch_organization(organization_id, trigger)


async def run_watch_background(
    organization_id: str,
    run_id: str,
    trigger: str,
    source_ids_filter: set[str] | None = None,
) -> None:
    """Feed-only scan in background (HTTP 202 already returned).

    ``source_ids_filter`` restricts the scan to specific ``regulatory_sources`` ids
    (per-source "Download" / "Monitor" actions from the Regulation Center).
    """
    try:
        sb.merge_run_stats(
            run_id,
            {
                "pipeline": "watch",
                "pipeline_stage_index": 0,
                "pipeline_stage_key": "monitoring",
                "pipeline_stage_label": "Scanning regulatory feeds…",
            },
        )
        sb.log_event(
            run_id,
            organization_id,
            "coordinator",
            "Watch pipeline: scanning regulatory feeds",
            {"source_ids": sorted(source_ids_filter) if source_ids_filter else None},
        )
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: pipeline.watch_organization(
                organization_id, trigger, parent_run_id=run_id, source_ids_filter=source_ids_filter
            ),
        )
        n = len(result.get("new_changes", []) or [])
        sb.log_event(
            run_id,
            organization_id,
            "info",
            f"Feed scan complete: {n} new change(s) in this pass",
            {"new_changes": n},
        )
        sb.finish_run(
            run_id,
            "completed",
            f"Watch: {n} new regulatory change(s)",
            {"new_changes": n, "pipeline": "watch"},
        )
    except Exception as e:
        sb.merge_run_stats(run_id, {"pipeline_error_message": str(e)[:1500]})
        sb.log_event(run_id, organization_id, "error", f"Watch pipeline failed: {e}", {})
        sb.finish_run(
            run_id,
            "failed",
            f"Watch error: {e}",
            {"pipeline": "watch"},
        )
        print(f"[coordinator] run_watch_background: {e}")


async def execute_coordinator_download(
    organization_id: str,
    run_id: str,
    trigger: str,
    source_ids_filter: set[str] | None = None,
) -> dict[str, Any]:
    """Detect new feed items and download their PDFs (no obligation/MAP extraction).

    Populates the Regulation Center inbox: scans the configured source(s),
    then ``ingest_regulatory_change`` for each detected item (download PDF,
    create document, set lifecycle to awaiting_approval/queued with a
    ``document_id``). ``source_ids_filter`` restricts to specific
    ``regulatory_sources`` ids (per-source "Download"); ``None`` scans all
    enabled sources ("Monitor / Download all").
    """
    totals: dict[str, Any] = {"changes": 0, "ingested": 0, "failed": 0}
    sb.log_event(
        run_id,
        organization_id,
        "coordinator",
        "Download pipeline: detect + download PDFs",
        {"source_ids": sorted(source_ids_filter) if source_ids_filter else None},
    )
    try:
        _stage(run_id, 0, "monitoring", "Scanning regulatory feeds…", "download")
        sb.log_event(
            run_id, organization_id, "sub_agent",
            "MonitoringAgent: scanning regulatory feeds",
            {"agent": "monitoring_agent"},
        )
        loop = asyncio.get_running_loop()
        watch = await loop.run_in_executor(
            None,
            lambda: pipeline.watch_organization(
                organization_id, trigger, parent_run_id=run_id, source_ids_filter=source_ids_filter
            ),
        )
        changes_all = watch.get("new_changes") or []
        totals["changes"] = len(changes_all)

        # Also fetch PDFs for previously-detected items that were never downloaded
        # (lifecycle new/awaiting_approval/failed_ingest with no document_id), so the
        # Download/Monitor buttons populate the inbox even when the feed has no fresh items.
        seen_ids = {str(c.get("_id")) for c in changes_all if c.get("_id")}
        backlog_rows = sb.list_undownloaded_changes(organization_id, source_ids_filter, limit=50)
        backlog: list[dict[str, Any]] = []
        for r in backlog_rows:
            rid = str(r.get("id"))
            if rid in seen_ids:
                continue
            backlog.append(
                {
                    "_id": rid,
                    "title": r.get("title") or "Regulatory change",
                    "summary": r.get("raw_text") or r.get("title") or "",
                    "url": r.get("url") or "",
                    "_regulator": r.get("regulator") or "Regulator",
                    "regulator": r.get("regulator") or "Regulator",
                    "_source_id": str(r.get("source_id")) if r.get("source_id") else None,
                }
            )

        max_c = config.MAX_REGULATORY_CHANGES_PER_FULL_RUN
        to_ingest = (changes_all + backlog)[:max_c]
        totals["backlog"] = len(backlog)
        sb.merge_run_stats(
            run_id,
            {
                "queue_detected_new_changes": len(changes_all),
                "queue_backlog_undownloaded": len(backlog),
                "queue_processing_slots": len(to_ingest),
            },
        )
        sb.log_event(
            run_id, organization_id, "info",
            f"Download targets: {len(changes_all)} newly detected + {len(backlog)} backlog (no PDF yet)",
            {"detected": len(changes_all), "backlog": len(backlog), "slots": len(to_ingest)},
        )

        _stage(run_id, 1, "ingest", "Downloading PDFs (Regulation Center)…", "download")
        for change in to_ingest:
            try:
                res = await pipeline.ingest_regulatory_change(organization_id, change, run_id)
                if res.get("document_id"):
                    totals["ingested"] += 1
                else:
                    totals["failed"] += 1
            except Exception as e:
                totals["failed"] += 1
                sb.log_event(
                    run_id, organization_id, "error",
                    f"ingest_regulatory_change failed: {e}",
                    {"change_title": change.get("title"), "error": str(e)[:2000]},
                )

        sb.finish_run(
            run_id,
            "completed",
            f"Download: {totals['changes']} detected, {totals['ingested']} PDF(s) downloaded, {totals['failed']} failed",
            {**totals, "pipeline": "download"},
        )
        return {"run_id": run_id, **totals}
    except Exception as e:
        sb.merge_run_stats(run_id, {"pipeline_error_message": str(e)[:1500]})
        sb.log_event(run_id, organization_id, "error", f"Download pipeline failed: {e}", {})
        sb.finish_run(run_id, "failed", f"Download error: {e}", {**totals, "pipeline": "download"})
        return {"run_id": run_id, "error": str(e), **totals}


async def run_download_background(
    organization_id: str,
    run_id: str,
    trigger: str,
    source_ids_filter: set[str] | None = None,
) -> None:
    try:
        await execute_coordinator_download(organization_id, run_id, trigger, source_ids_filter)
    except Exception as e:
        print(f"[coordinator] run_download_background: {e}")


async def execute_coordinator_process_regulations(organization_id: str, run_id: str, trigger: str) -> dict[str, Any]:
    """Drain the regulation processing queue (obligations + MAPs) without a new feed scan."""
    totals: dict[str, Any] = {"obligations": 0, "maps": 0, "processed": 0}
    sb.log_event(run_id, organization_id, "coordinator", "Regulation queue processor", {"pipeline": "process_regulations"})
    try:
        _stage(run_id, 0, "queue", "Processing regulation queue…", "process_regulations")
        reclaimed = sb.reclaim_stuck_processing(organization_id)
        if reclaimed:
            sb.log_event(
                run_id, organization_id, "info",
                f"Requeued {reclaimed} regulation(s) stuck in 'processing' from a prior interrupted run.",
                {"reclaimed": reclaimed},
            )
        max_c = config.MAX_REGULATORY_CHANGES_PER_FULL_RUN
        for _ in range(max_c):
            batch = sb.list_regulation_process_queue(organization_id, limit=1)
            if not batch:
                break
            cid = str(batch[0]["id"])
            try:
                res = await pipeline.process_regulation_extraction(organization_id, cid, run_id)
                totals["obligations"] += int(res.get("obligations") or 0)
                totals["maps"] += int(res.get("maps") or 0)
                totals["processed"] += 1
            except Exception as e:
                sb.log_event(
                    run_id,
                    organization_id,
                    "error",
                    f"process_regulation_extraction failed: {e}",
                    {"change_id": cid, "error": str(e)[:2000]},
                )
        sb.finish_run(
            run_id,
            "completed",
            f"Regulation queue: {totals['processed']} item(s), {totals['obligations']} obligations, {totals['maps']} MAPs",
            totals,
        )
        return {"run_id": run_id, **totals}
    except Exception as e:
        sb.merge_run_stats(run_id, {"pipeline_error_message": str(e)[:1500]})
        sb.finish_run(run_id, "failed", f"Regulation queue error: {e}", totals)
        return {"run_id": run_id, "error": str(e), **totals}


async def run_process_regulations_background(organization_id: str, run_id: str, trigger: str) -> None:
    try:
        await execute_coordinator_process_regulations(organization_id, run_id, trigger)
    except Exception as e:
        print(f"[coordinator] run_process_regulations_background: {e}")
