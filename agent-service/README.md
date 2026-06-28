# Suraksha ADK Agent Service

An autonomous, multi-agent **regulatory intelligence** service built with the
**Google Agent Development Kit (ADK)** and **Gemini**. It monitors regulatory
changes (RBI / SEBI / PMLA), translates them into **Measurable Action Points
(MAPs)**, assigns them to the correct bank department, and autonomously validates
completion from collected evidence. Results are written into the same Supabase
tables the Next.js app uses, so they appear live in the existing dashboards and
on the MAP board (flagged with an "AI Agent" badge).

## Architecture

```
RegWatcher ──► ObligationExtractor ──► MAPGenerator ──► DepartmentAssigner ──► Supabase
(httpx/feeds)   (Gemini/ADK)            (Gemini/ADK)      (Gemini/ADK + tool)     │
                                                                                  ▼
                                          EvidenceValidator (Gemini/ADK) ──► MAP completion + audit
```

- `app/agents.py` — ADK `LlmAgent`s (obligation_extractor, map_generator, department_assigner, evidence_validator) + a `SequentialAgent` workflow. `department_assigner` and `evidence_validator` use ADK function tools (`app/tools.py`) backed by Supabase.
- `app/fetchers.py` — live RBI/SEBI/PMLA feeds; optional **`SURAKSHA_REGULATORY_FEED_SAMPLES=true`** injects sample rows if a feed fails (default: off). Uses a **browser-like `User-Agent`** (or **`SURAKSHA_HTTP_USER_AGENT`**) so regulator CDNs do not return HTML interstitials instead of RSS/PDF bodies.
- `app/pdf_ingest.py` — resolve PDF links from notification pages, download with size cap, extract text (**pypdf**, no OCR). RBI **`rbidocs.rbi.org.in`** returns **HTML instead of `%PDF`** for bot-like agents unless the UA looks like a real browser; downloads also send **`Referer: <notification page>`** when the pipeline has that URL.
- `app/pipeline.py` — orchestration that persists between stages (tenant-scoped by `organization_id`).
- `app/main.py` — FastAPI API + APScheduler autonomy loops.

## Setup

```bash
cd agent-service
python -m venv .venv
# Windows:  .venv\Scripts\activate     |  macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in GEMINI_API_KEY + SUPABASE creds + AGENT_SHARED_SECRET + NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET (optional)
```

Get a free Gemini API key at https://aistudio.google.com/app/apikey.

### Local LLM (Ollama) instead of Gemini

When Gemini free-tier **quota (429)** is exhausted, or you prefer offline inference:

1. Install [Ollama](https://ollama.com/) and pull a model, e.g. `ollama pull llama3.2`.
2. Ensure **`litellm`** is installed (`pip install -r requirements.txt`).
3. In `agent-service/.env` set:
   - **`SURAKSHA_USE_LOCAL_LLM=true`**
   - **`LOCAL_LLM_API_BASE=http://127.0.0.1:11434`** (default)
   - **`LOCAL_LLM_MODEL=ollama_chat/llama3.2`** — must match a tag from `ollama list` (use the `ollama_chat/...` prefix for ADK compatibility).

`GET /health` returns **`llm_backend`** (`gemini` vs `local_litellm`) and the active **`model`** string. You can leave **`GEMINI_API_KEY`** unset when using local only.

## Run

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8088
# or: python -m uvicorn app.main:app --reload --port 8088
```

Health check: `GET http://localhost:8088/health`, or open **`http://localhost:8088/`** in a browser (redirects to `/health`).

There is **no JSON API at `/`** beyond that redirect; use **`/runs`** and **`/changes`** with `X-Agent-Secret` as documented.

### Troubleshooting (Windows)

If `python -m venv .venv` fails with **Unable to copy … venvlauncher.exe**, another process may be locking `.venv` (or the folder is incomplete). Close editors/terminals using that venv, delete `agent-service\.venv`, and recreate the venv. If it keeps failing, try `python -m venv .venv --copies` or create the venv in a directory without spaces, then point your IDE/terminal at it.

**`SSL: CERTIFICATE_VERIFY_FAILED` when calling Gemini** — the service loads
[`app/ssl_fix.py`](app/ssl_fix.py) before the Google SDK: it uses **truststore** (OS
certificate store on Windows/macOS) and stops pinning **certifi-only** CA paths that
`google-genai` would otherwise force. Restart uvicorn after `pip install -r requirements.txt`.

If TLS still fails (strict corporate HTTPS inspection), install your organisation’s
root CA into the Windows trust store, or set **`SSL_CERT_FILE`** to a PEM bundle that
includes that root.

**Dev only (insecure):** `SURAKSHA_INSECURE_LLM_SSL=true` disables TLS verification for
Gemini HTTP calls — use only to confirm connectivity, never in production.

**`litellm.Timeout: Timeout passed=600` / `httpx.ReadTimeout` to Ollama** — LiteLLM uses its own
HTTP read timeout (often **600s**) to the Ollama API. That is **independent** of
`SURAKSHA_AGENT_LLM_TIMEOUT_SEC`. The service passes **`timeout=LITELLM_HTTP_TIMEOUT_SEC`** into
`LiteLlm` (default when local: **max(1800, 2× agent timeout + 300)** seconds). Override with
**`SURAKSHA_LITELLM_HTTP_TIMEOUT_SEC`** if audit/drift still hit read timeouts.

**`Root node … was cancelled` (local Ollama)** — the outer guard is **`asyncio.wait_for`** using
**`SURAKSHA_AGENT_LLM_TIMEOUT_SEC`**. With **`SURAKSHA_USE_LOCAL_LLM=true`** the default is **900s**
per agent (vs **180s** for Gemini). Raise **`SURAKSHA_AGENT_LLM_TIMEOUT_SEC`** if the **outer** wait
fires before LiteLLM returns, and restart uvicorn.

**No obligations or MAPs after `full`** — extraction runs only for **new** items from that run’s
feed scan. If nothing new was detected (or `process_change` errored), counts stay at zero. Check
**`agent_events`** on the coordinator run for `No new regulatory_changes` or `process_change failed`.
For offline demos you can enable **`SURAKSHA_REGULATORY_FEED_SAMPLES=true`**.

## API

| Method | Path | Body / Query | Auth |
|--------|------|--------------|------|
| GET  | `/` | — (redirects to `/health`) | none |
| GET  | `/health` | — | none |
| POST | `/runs` | `{ organization_id, pipeline: "watch"\|"full"\|"validate" }` | `X-Agent-Secret` |
| GET  | `/runs` | `?organization_id=` | `X-Agent-Secret` |
| GET  | `/changes` | `?organization_id=` | `X-Agent-Secret` |

- `watch` — detect new regulatory changes only (**HTTP 202** with `{ "accepted": true, "run_id": "<uuid>", "pipeline": "watch" }`). Feed scan runs in a **background task**; events attach to that `agent_runs` row when using the standalone watch API.
- `full` — watch + extract obligations + generate/assign MAPs + drift/impact/audit (**HTTP 202** with `{ "accepted": true, "run_id": "<uuid>", "pipeline": "full" }`). Work runs in a **background task**; progress is stored on that `agent_runs` row under **`stats.pipeline_stage_index`**, **`stats.pipeline_stage_label`**, and on failure **`stats.pipeline_failed_stage_index`** / **`stats.pipeline_error_message`**.
- `validate` — validate open MAPs + audit (**HTTP 202** with the same `accepted` / `run_id` shape, `pipeline: "validate"`).

The Next.js app may poll **`GET /api/agents/runs/progress?run_id=`** (Supabase) for detail pages; the compliance dashboard primarily relies on **Realtime `agent_events`** for live progress after a 202 accept.

## Autonomy

When `ENABLE_SCHEDULER=1`, APScheduler enqueues the **same coordinator** `full` and `validate` pipelines per org using **HTTP-202-style** `agent_runs` rows (`run_full_background` / `run_validate_background`) so each tick does not block the event loop on synchronous `run_full`/`run_validate`.

Optional env (see root `README.md`): `SURAKSHA_REGULATORY_FEED_SAMPLES`, `AUTOMATIC_PDF_STRICT`, `SURAKSHA_PDF_MAX_BYTES`, `SURAKSHA_PDF_MIN_TEXT_CHARS`, `SURAKSHA_USE_LOCAL_LLM`, `LOCAL_LLM_API_BASE`, `LOCAL_LLM_MODEL`, `SURAKSHA_AGENT_LLM_TIMEOUT_SEC`, `SURAKSHA_LITELLM_HTTP_TIMEOUT_SEC`, `SURAKSHA_REGULATORY_FEEDS_RBI_ONLY`, `SURAKSHA_MAX_REGULATORY_CHANGES_PER_FULL_RUN`, `SURAKSHA_PDF_CHUNK_EXTRACTION`, `SURAKSHA_PDF_CHUNK_CHARS`, `SURAKSHA_PDF_CHUNK_MIN_SPLIT_CHARS`, `SURAKSHA_PDF_CHUNK_PARALLEL_MAX`.

### RBI feed + PDF smoke test (no LLM)

```bash
cd agent-service
python scripts/test_rbi_feed_pdf.py --limit 5
python scripts/test_rbi_feed_pdf.py --feed press --limit 5
python scripts/test_rbi_feed_pdf.py --find-pdf --scan 25 --download
```

Use **`--feed press`** for press releases (`pressreleases_rss.xml`). **`--find-pdf`** walks more entries until a PDF resolves; pair with **`--download`** to verify extraction.

If older RSS items still use **`http://www.rbi.org.in/...`**, the service upgrades them to **HTTPS** before fetch (HTTP often returns **404**, so PDF detection would silently fail). PDF picking ranks **`/rdocs/notification/PDFs/`** on notification pages and **`/rdocs/PressRelease/PDFs/`** on press pages ahead of shared footer PDFs.

### Download 2026 PDFs to Desktop (live RSS, no LLM)

Writes under **`Desktop/SurakshaRegulatoryPDFs2026`** (Windows: `%USERPROFILE%\Desktop\...`) and a **`manifest.json`**.

```bash
cd agent-service
python scripts/fetch_regulatory_pdfs_2026.py
python scripts/fetch_regulatory_pdfs_2026.py --max 15 --regulators RBI SEBI --rbi-press
python scripts/fetch_regulatory_pdfs_2026.py --dry-run   # resolve URLs only
```

Options: **`--year`**, **`--out`**, **`--manifest`**. RSS-only regulators in this script: **RBI**, **SEBI** (HTML-only catalog slots need separate tooling).

## Next.js integration

The Next.js app calls this service via server-side proxy routes
(`/api/agents/runs`, `/api/agents/status`) using `AGENT_SERVICE_URL` and
`AGENT_SHARED_SECRET`. The `/agents` page in the app triggers runs and shows
detected changes + run history.
