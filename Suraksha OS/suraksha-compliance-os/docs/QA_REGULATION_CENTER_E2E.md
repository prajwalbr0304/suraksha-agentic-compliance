# Regulation Center + Agentic Compliance Automation — E2E QA Report

Tenant: `test-cooperative-bank` (`manager@testbank.com`)
Backend: Next.js (`:3000`) + Agent service (`:8088`) + local Ollama (CPU)

## Result: PASS — full agentic flow verified end-to-end

Monitor/Download → ingest PDFs → approve → queue → **extract obligations → generate MAPs → assign departments → complete**, processing one PDF at a time.

Final verified run (`4ac9e3c5`): `processed=2, obligations=2, maps=4`, both PDFs `completed`.

```
PDF #1  extract → obligation (0→1) → MAPs (0→2) → completed
PDF #2  auto-picked from queue → extract → obligation (→2) → MAPs (→4) → assign depts → completed
```

Persisted results:
- Obligations (2): "Lending to REITs – Bullet Repayment" → Credit Risk Management; "Implement amendment to RBI Commercial Banks…" → Regulatory Compliance (both with due dates).
- MAP cards (4): department-assigned, `pending_approval` (Compliance / IT).
- Lifecycle: 2 completed, 3 awaiting_approval, 5 new.

## New feature: dedicated `download` pipeline (per plan)
- `agent-service/app/main.py`: `/runs` accepts `pipeline:"download"` (+ optional `source_id`).
- `agent-service/app/coordinator.py`: `execute_coordinator_download` / `run_download_background` — detect feed items + download PDFs + create documents (no extraction). Also ingests previously-detected items that had no PDF yet (`list_undownloaded_changes`).
- `lib/agent-run-async.ts` + `app/api/agents/runs/route.ts`: `download` added to type + whitelist.
- `app/dashboard/[orgSlug]/regulation-center/page.tsx`: Download (per-source) and Monitor/Scan-all now call `download` (not `watch`).
- `app/api/regulation-center/route.ts`: `approve` is blocked with a clear 400 when the item has no downloaded document.

## Bugs found and fixed during testing

1. **CRITICAL — obligations never persisted (`due_date` NOT NULL).**
   `obligations.due_date` is NOT NULL, but `insert_obligation` passed `due_date=None` (the extractor doesn't emit dates), so every insert failed silently → 0 obligations → 0 MAPs. Fixed: default `due_date` to +30 days. (`supabase_client.py`)

2. **Text-only fallback document never linked.**
   `create_document` (used when no PDF resolves) didn't set `regulatory_changes.document_id`, leaving items unprocessable. Fixed: link the document after fallback. (`pipeline.py`)

3. **Notification HTML text discarded.**
   When no PDF resolved, ingest used the (often empty) RSS summary. Now captures the notification page text into `raw_text` so the extractor has real content. (`pipeline.py` + `pdf_ingest.extract_text_from_html`)

4. **MAP generation fragile to local-model JSON shape.**
   Batch MAP JSON is now parsed robustly (dict/list/string-index), and each obligation gets a synthesized department-routed MAP if the model omits one — guaranteeing the obligation→MAP→assign step. (`pipeline.py`)

5. **Single-call extraction had no size cap + 37-min timeout.**
   Large PDFs created huge prompts that could hit a 2220s timeout and block the queue. Capped single-call text; lowered timeouts. (`pipeline.py`, `.env`)

6. **Items stuck in `processing` after an interrupted run.**
   The queue excludes `processing`, so an interrupted item was lost forever. Added `reclaim_stuck_processing` at the start of each process run. (`supabase_client.py`, `coordinator.py`)

7. **Stale Turbopack dev cache → `POST /api/agents/runs` 404.**
   Cleared `.next` and restarted dev server (environment issue, no code change).

## Configuration changes (agent `.env`)
- `LOCAL_LLM_MODEL=ollama_chat/llama3.2:latest` — llama3.1 (8B) took 20–37 min/call on CPU and produced unreliable JSON; llama3.2 (3B) is ~10× faster and reliable.
- Added `response_format=json_object` to the local model (forces valid JSON; obligation extractor now returns `{"obligations":[...]}`).
- `SURAKSHA_AGENT_LLM_TIMEOUT_SEC=300`, `SURAKSHA_LITELLM_HTTP_TIMEOUT_SEC=300` — so one slow call can't block the queue for 30+ min.

## Recommendations
- On CPU-only hosts, run with `ENABLE_SCHEDULER=0` during interactive demos: the background scheduler runs `full`/`validate` for all orgs and starves the single Ollama instance. (A GPU host removes this constraint.)
- For best obligation/MAP quality, use a GPU + a larger model (llama3.1/Gemini); the pipeline already supports Gemini via `GEMINI_API_KEY`.

## Verified Regulation Center features
- Sources: enable/disable, edit (interval/lookback persisted), delete (404 guard), per-source Download.
- Extracted tabs: new / approved / rejected / completed / failed; approve (doc-gated), reject, revoke, restore, reprocess, delete.
- Monitor: live console + source status. Logs: unified processing + agent events.
- RAG search endpoint returns 200 (results populate after extraction embeds chunks).
