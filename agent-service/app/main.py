"""FastAPI entrypoint for the Suraksha ADK agent service.

Endpoints (all except / and /health require X-Agent-Secret):
  GET  /           → redirect to /health
  GET  /health
  POST /runs        {organization_id, pipeline: watch|full|validate|process_regulations}
  GET  /runs        ?organization_id=
  GET  /changes     ?organization_id=

Autonomy: APScheduler runs per-source regulation ticks, full coordinator passes, validate sweeps.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from typing import Optional

from . import ssl_fix  # noqa: F401 — TLS for Gemini before other app imports
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Query
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel

from . import config
from . import supabase_client as sb
from . import pipeline
from . import coordinator
from . import agents as A

scheduler = None


def _check_secret(secret: Optional[str]) -> None:
    if not config.AGENT_SHARED_SECRET:
        raise HTTPException(status_code=500, detail="AGENT_SHARED_SECRET not configured on the service")
    got = (secret or "").strip()
    if got != config.AGENT_SHARED_SECRET:
        raise HTTPException(status_code=401, detail="Invalid agent secret")


async def _scheduled_regulation_ticks():
    """Per-source feed scans when ``fetch_interval_minutes`` elapses (Regulation Center)."""
    if not config.REGULATION_CENTER_ENABLED:
        return
    due = pipeline.regulatory_sources_due_for_fetch()
    loop = asyncio.get_running_loop()
    for org_id, ids in due.items():
        try:
            await loop.run_in_executor(
                None,
                lambda oid=org_id, s=ids: pipeline.watch_organization(
                    str(oid), "scheduled", source_ids_filter=set(s)
                ),
            )
        except Exception:
            pass


async def _scheduled_watch():
    for org_id in pipeline.all_org_ids():
        try:
            run_id = sb.start_run(org_id, "coordinator", "scheduled")
            sb.merge_run_stats(run_id, {"pipeline": "full"})
            await coordinator.run_full_background(org_id, run_id, "scheduled")
        except Exception:
            pass


async def _scheduled_validate():
    for org_id in pipeline.all_org_ids():
        try:
            run_id = sb.start_run(org_id, "coordinator", "scheduled")
            sb.merge_run_stats(run_id, {"pipeline": "validate"})
            await coordinator.run_validate_background(org_id, run_id, "scheduled")
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    global scheduler
    if config.ENABLE_SCHEDULER:
        try:
            from apscheduler.schedulers.asyncio import AsyncIOScheduler
            scheduler = AsyncIOScheduler()
            scheduler.add_job(
                _scheduled_regulation_ticks,
                "interval",
                minutes=config.REGULATION_SCHEDULER_TICK_MINUTES,
                id="regulation_tick",
            )
            scheduler.add_job(_scheduled_watch, "interval", minutes=config.WATCH_INTERVAL_MINUTES, id="watch")
            scheduler.add_job(_scheduled_validate, "interval", hours=config.VALIDATE_INTERVAL_HOURS, id="validate")
            scheduler.start()
        except Exception as e:
            print(f"[scheduler] disabled: {e}")
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Suraksha ADK Agent Service", version="1.0.0", lifespan=lifespan)


class RunRequest(BaseModel):
    organization_id: str
    pipeline: str = "full"  # watch | full | validate | process_regulations
    source_id: Optional[str] = None  # restrict watch/download to one regulatory_sources row


@app.get("/")
async def root():
    return RedirectResponse(url="/health", status_code=307)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "llm_configured": config.llm_available(),
        "llm_backend": config.llm_backend(),
        "model": config.llm_model_label(),
        "scheduler": config.ENABLE_SCHEDULER,
    }


@app.post("/runs")
async def trigger_run(
    body: RunRequest,
    background_tasks: BackgroundTasks,
    x_agent_secret: Optional[str] = Header(default=None),
):
    _check_secret(x_agent_secret)
    if not config.llm_available():
        raise HTTPException(
            status_code=503,
            detail="LLM not configured: set GEMINI_API_KEY for Gemini, or SURAKSHA_USE_LOCAL_LLM=true with Ollama running (see agent-service README).",
        )
    if body.pipeline == "watch":
        run_id = sb.start_run(body.organization_id, "coordinator", "manual")
        sb.merge_run_stats(run_id, {"pipeline": "watch"})
        source_ids = {body.source_id.strip()} if body.source_id and body.source_id.strip() else None
        background_tasks.add_task(
            coordinator.run_watch_background, body.organization_id, run_id, "manual", source_ids
        )
        return JSONResponse(
            status_code=202,
            content={"accepted": True, "run_id": run_id, "pipeline": "watch"},
        )

    if body.pipeline == "download":
        if not config.REGULATION_CENTER_ENABLED:
            raise HTTPException(status_code=400, detail="REGULATION_CENTER_ENABLED is false")
        run_id = sb.start_run(body.organization_id, "coordinator", "manual")
        sb.merge_run_stats(run_id, {"pipeline": "download"})
        source_ids = {body.source_id.strip()} if body.source_id and body.source_id.strip() else None
        background_tasks.add_task(
            coordinator.run_download_background, body.organization_id, run_id, "manual", source_ids
        )
        return JSONResponse(
            status_code=202,
            content={"accepted": True, "run_id": run_id, "pipeline": "download"},
        )

    if body.pipeline == "validate":
        run_id = sb.start_run(body.organization_id, "coordinator", "manual")
        sb.merge_run_stats(run_id, {"pipeline": "validate"})
        background_tasks.add_task(coordinator.run_validate_background, body.organization_id, run_id, "manual")
        return JSONResponse(
            status_code=202,
            content={"accepted": True, "run_id": run_id, "pipeline": "validate"},
        )

    if body.pipeline == "process_regulations":
        if not config.REGULATION_CENTER_ENABLED:
            raise HTTPException(status_code=400, detail="REGULATION_CENTER_ENABLED is false")
        run_id = sb.start_run(body.organization_id, "coordinator", "manual")
        sb.merge_run_stats(run_id, {"pipeline": "process_regulations"})
        background_tasks.add_task(
            coordinator.run_process_regulations_background, body.organization_id, run_id, "manual"
        )
        return JSONResponse(
            status_code=202,
            content={"accepted": True, "run_id": run_id, "pipeline": "process_regulations"},
        )

    run_id = sb.start_run(body.organization_id, "coordinator", "manual")
    sb.merge_run_stats(run_id, {"pipeline": "full"})
    background_tasks.add_task(coordinator.run_full_background, body.organization_id, run_id, "manual")
    return JSONResponse(
        status_code=202,
        content={"accepted": True, "run_id": run_id, "pipeline": "full"},
    )


@app.get("/agents")
async def list_agents(x_agent_secret: Optional[str] = Header(default=None)):
    """Expose the Coordinator's named sub-agents (for the dashboard / observability)."""
    _check_secret(x_agent_secret)
    return {"coordinator": "coordinator", "sub_agents": A.SUB_AGENTS}


@app.get("/runs")
async def list_runs(organization_id: str = Query(...), x_agent_secret: Optional[str] = Header(default=None)):
    _check_secret(x_agent_secret)
    res = sb.db().table("agent_runs").select("*").eq("organization_id", organization_id).order("started_at", desc=True).limit(25).execute()
    return res.data or []


@app.get("/changes")
async def list_changes(organization_id: str = Query(...), x_agent_secret: Optional[str] = Header(default=None)):
    _check_secret(x_agent_secret)
    res = sb.db().table("regulatory_changes").select("*").eq("organization_id", organization_id).order("created_at", desc=True).limit(50).execute()
    return res.data or []
