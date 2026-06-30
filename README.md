<div align="center">

<img src="docs/showcase/screenshots/00-public/01-landing.png" alt="Suraksha OS — AI Compliance Operating System" width="880" />

# 🛡️ Suraksha OS — The AI Compliance Operating System

**An agentic platform that monitors regulatory change, translates it into Measurable Action Points, routes them to the right bank department, and autonomously validates completion — purpose-built for RBI · SEBI · PMLA · BASEL.**

[![Next.js 16](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)](https://nextjs.org/)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript 5](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind 4](https://img.shields.io/badge/Tailwind-4-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS%20%2B%20pgvector-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Google ADK](https://img.shields.io/badge/Agents-Google%20ADK%20%2B%20Gemini-4285F4?logo=google&logoColor=white)](https://ai.google.dev/)
[![FastAPI](https://img.shields.io/badge/Agent%20Service-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![License](https://img.shields.io/badge/License-Apache%202.0-D22128?logo=apache&logoColor=white)](LICENSE)

</div>

---

## ✨ Live demo

> A fly-through of the platform — landing, the founder multi-tenant console, the AI agent fleet, the Compliance Action Board, the knowledge graph, drift, readiness, evidence, impact and analytics.

<div align="center">

<video src="https://github.com/prajwalbr0304/suraksha-agentic-compliance/releases/download/showcase-assets/suraksha-demo.mp4" controls muted width="880"></video>

![Suraksha OS demo](docs/showcase/video/suraksha-demo-preview.gif)

*The looping preview above always renders; the embedded player shows the full **8-minute walkthrough**. ▶ [Watch / download the MP4](https://github.com/prajwalbr0304/suraksha-agentic-compliance/releases/download/showcase-assets/suraksha-demo.mp4) — every screen was captured live from the running app.*

</div>

---

## 📚 Contents

- [What is Suraksha OS?](#-what-is-suraksha-os)
- [The agentic AI system](#-the-agentic-ai-system) ← *the heart of the product*
- [System architecture](#-system-architecture)
- [Multi-tenant model & RBAC](#-multi-tenant-model--rbac)
- [Founder console (cross-tenant)](#-founder-console-cross-tenant)
- [The tenant workspace, module by module](#-the-tenant-workspace-module-by-module)
- [Every role, captured](#-every-role-captured)
- [Tech stack](#-tech-stack)
- [Data model](#-data-model)
- [Getting started](#-getting-started)
- [Reproducing this showcase](#-reproducing-this-showcase)
- [Security](#-security)

---

## 🎯 What is Suraksha OS?

Indian banks drown in regulatory change. Every RBI / SEBI / PMLA circular has to be **read**, broken into **obligations**, turned into **concrete tasks**, **assigned** to the right department, **evidenced**, and **proven** to auditors. Today that is manual, slow, and error-prone.

**Suraksha OS turns that lifecycle into an autonomous loop:**

| Stage | What happens | Who/what does it |
|------|--------------|------------------|
| **Monitor** | Regulator RSS/HTML feeds are scanned; new circulars are detected and their PDFs ingested. | `MonitoringAgent` |
| **Translate** | Circular text is parsed into discrete, actionable **obligations** with priority, risk & citation. | `ObligationAgent` (LLM) |
| **Assign** | Each obligation becomes 1–3 **Measurable Action Points (MAPs)**, routed to the best-fit department. | `MapAgent` + `RoutingAgent` (LLM + tools) |
| **Validate** | Evidence is checked against each MAP; readiness scores recompute; drift, impact & audit narratives are generated. | `EvidenceAgent`, `DriftAgent`, `ImpactAgent`, `AuditAgent` |

Humans stay in control through approval gates, while the AI does the busywork. The result is a single workspace for **documents, obligations, a Compliance Action Board, a knowledge graph, drift analysis, evidence, readiness scoring, impact simulation, audit trails and analytics** — multi-tenant across many banks.

---

## 🤖 The agentic AI system

> This is what makes Suraksha OS more than a dashboard. A dedicated **Python agent service** runs a **Google ADK** multi-agent system, orchestrated by a **Coordinator**, with **Gemini** (cloud) or a **local Ollama** model (offline) doing the reasoning — all results persisted to Supabase so every autonomous action is observable in the UI.

<div align="center">

![AI Agents control center](docs/showcase/screenshots/founder/09-agents.png)

*The live agent control center: fleet status, the running pipeline, the activity timeline, and recent coordinator runs.*

</div>

### How it is built

The agent service is a **FastAPI** app (`agent-service/`) that exposes a tiny, secured surface and runs the heavy reasoning in background tasks:

```
POST /runs   { organization_id, pipeline: watch | download | full | process_regulations | validate }
GET  /runs    ?organization_id=          # recent agent_runs for the org
GET  /agents                             # the Coordinator's registered sub-agents
GET  /health                             # llm backend + model + scheduler status
```

Every mutating call is authenticated with a shared `X-Agent-Secret` header, returns **`202 Accepted`** immediately, and continues work in a FastAPI `BackgroundTasks` handler. The Next.js app then **polls `agent_runs`** for the same `run_id`, which is how the UI shows a live, stage-by-stage progress bar.

### The model layer (LLM)

The reasoning models are pluggable through one abstraction in `agent-service/app/agents.py`:

| Backend | Model | When |
|---------|-------|------|
| **Gemini** (default) | `gemini-2.5-flash` via Google ADK + `google-genai` | Cloud, fast, high-quality JSON |
| **Local** | `ollama_chat/llama3.2` via **LiteLLM** (OpenAI-compatible) | Offline / no quota, `response_format=json_object` forces parseable JSON |

Every agent is an ADK `LlmAgent` with a tightly-scoped system prompt that **must return strict JSON** (e.g. `{"obligations":[…]}`). A defensive `parse_json()` recovers the first valid JSON object/array even if a small local model wraps it in prose. Long calls are guarded by `asyncio.wait_for` with backend-aware timeouts so one slow inference never wedges the queue.

### The agent fleet

A single **`CoordinatorAgent`** owns one parent `agent_runs` row and dispatches named sub-agents, attributing a child `agent_events` row to each — giving you full provenance for every autonomous decision.

| Agent | Responsibility | Writes to | Tools |
|-------|----------------|-----------|-------|
| `MonitoringAgent` | Scan regulator feeds, detect new circulars | `regulatory_changes` | RSS/HTML fetchers |
| `obligation_extractor` | Extract discrete obligations from circular text | `obligations` | — |
| `map_generator` / `map_and_route_batch` | Generate Measurable Action Points (+ routing) | `map_cards` | — |
| `department_assigner` (`RoutingAgent`) | Assign each MAP to the best-fit department | `map_cards`, `escalations` | `get_departments` |
| `evidence_validator` (`EvidenceAgent`) | Decide if evidence completes a MAP | `map_cards`, `readiness_scores` | — |
| `drift_analyzer` (`DriftAgent`) | Compare circular versions, score regulatory drift | `drift_comparisons` | — |
| `impact_assessor` (`ImpactAgent`) | Assess operational/audit impact of a change | `impact_simulations` | `get_departments` |
| `audit_summarizer` (`AuditAgent`) | Write audit-ready narratives of automation activity | `audit_trail`, `audit_exports` | — |
| `pdf_url_resolver` | LLM-assisted discovery of a direct PDF URL from a notification page | `regulation_processing_log` | — |
| `regulation_tagger` | Propose category, tags & an executive summary for the inbox | `regulatory_changes` | — |

ADK **function tools** (`get_departments`, `get_open_map_cards`) let agents query live tenant state, so routing decisions are grounded in the bank's *actual* org structure — not hallucinated.

### Retrieval (RAG) without an external embedding API

For the knowledge graph and regulation search, text is embedded with a **deterministic 384-dimension hashing-trick embedding** that is byte-for-byte identical between the TypeScript app (`lib/regulation-embedding.ts`) and the Python service. Vectors are stored in Postgres **`pgvector`**, so similarity search runs entirely inside the database with zero per-token API cost.

### Autonomy & scheduling

An **APScheduler** loop inside the service runs the platform hands-free:

- per-source regulation feed ticks (every few minutes),
- full coordinator passes (hourly), and
- validation sweeps (daily).

Each background pipeline is **idempotent**, **tenant-scoped by `organization_id`**, processes a bounded batch per run, and defers the rest — so a flood of new circulars degrades gracefully instead of blowing up.

### The agent pipeline, end to end

```mermaid
sequenceDiagram
    autonumber
    participant UI as Next.js UI
    participant API as Next.js API route
    participant SVC as FastAPI agent service
    participant CO as CoordinatorAgent
    participant LLM as Gemini / Ollama (ADK)
    participant DB as Supabase (Postgres + pgvector)

    UI->>API: Trigger "Run agents" (full)
    API->>SVC: POST /runs (X-Agent-Secret)
    SVC-->>API: 202 Accepted { run_id }
    API-->>UI: run_id (UI starts polling)
    Note over SVC,CO: BackgroundTasks
    CO->>DB: start_run() + log "dispatching sub-agents"
    CO->>SVC: MonitoringAgent → scan feeds
    SVC->>DB: insert regulatory_changes
    loop per new circular (bounded)
        CO->>LLM: obligation_extractor(text)
        LLM-->>CO: { obligations[] }
        CO->>DB: insert obligations
        CO->>LLM: map_and_route_batch(obligations, departments)
        LLM-->>CO: { assignments[] (MAPs + department) }
        CO->>DB: insert map_cards (+ escalations)
    end
    par Drift & Impact
        CO->>LLM: drift_analyzer(old, new)
        CO->>LLM: impact_assessor(change)
    end
    CO->>DB: insert drift_comparisons, impact_simulations
    CO->>LLM: audit_summarizer(recent events)
    CO->>DB: insert audit_trail + finish_run("completed", totals)
    UI->>DB: poll agent_runs → live stage progress ✓
```

---

## 🏗 System architecture

High-level view of how the browser, the Next.js surfaces, the API route handlers, persistence, and the autonomous agent service connect.

```mermaid
flowchart TB
    subgraph Personas["👥 Personas"]
        Founder(("Platform founder"))
        Admin(("Bank manager / admin"))
        Staff(("Compliance · Security · IT · Audit · Exec"))
    end

    subgraph Web["▲ Next.js 16 (App Router · React 19)"]
        direction TB
        Marketing["Landing / Auth"]
        FounderUI["Founder console<br/>/founder/**"]
        TenantUI["Tenant workspace<br/>/dashboard/{org}/**"]
        Proxy["Edge proxy<br/>(auth gate)"]
        API["API route handlers<br/>/api/** (RBAC + ABAC)"]
    end

    subgraph Data["🟢 Supabase"]
        PG[("PostgreSQL<br/>+ Row-Level Security")]
        Vec[("pgvector<br/>embeddings")]
        Store[("Storage<br/>circular PDFs")]
        Auth[("Auth / JWT")]
    end

    subgraph Agents["🤖 Agent service — FastAPI + Google ADK"]
        direction TB
        Coord["CoordinatorAgent"]
        Fleet["Monitoring · Obligation · MAP · Routing<br/>Evidence · Drift · Impact · Audit"]
        Sched["APScheduler<br/>(watch · full · validate)"]
    end

    subgraph LLM["🧠 Reasoning"]
        Gemini["Gemini 2.5 Flash"]
        Ollama["Ollama (llama3.2)<br/>via LiteLLM"]
    end

    Regs["🏛 RBI · SEBI · PMLA feeds & PDFs"]

    Personas --> Web
    Marketing --> Auth
    FounderUI --> API
    TenantUI --> API
    Proxy -. guards .-> TenantUI
    API <--> PG
    API <--> Store
    API -->|trigger /runs<br/>X-Agent-Secret| Coord
    Coord --> Fleet
    Sched --> Coord
    Fleet <--> LLM
    Fleet --> PG
    Fleet --> Vec
    Fleet --> Store
    Fleet -->|fetch| Regs
    API -->|poll agent_runs| PG
```

---

## 🔐 Multi-tenant model & RBAC

Suraksha OS is **multi-tenant by design**. A platform **founder** sees every bank; each bank (tenant) is fully isolated, and within a bank a rich set of **personas** get least-privilege access enforced at three layers: **RBAC** (route + nav), **ABAC** (department scoping), and **Postgres Row-Level Security** (data).

| Persona | Sees | Typical scope |
|---------|------|---------------|
| `founder` | All banks, cross-tenant analytics & access control | Platform |
| `org_admin` / `bank_manager` | Full bank workspace + user/department/team admin | One bank |
| `compliance_admin` | Compliance ops across all departments | Org-wide |
| `compliance_analyst` | Documents, evidence, readiness, reports | Department |
| `security_team` | Security findings, MAPs, evidence | Department |
| `it_owner` | IT MAPs, action board, evidence | Department |
| `department_owner` | Their department's obligations & MAPs | Department |
| `internal_auditor` / `external_auditor` | Read-only audit, evidence, reports, knowledge graph | Org / engagement |
| `executive_viewer` | Executive dashboard, impact, analytics, reports | Org-wide (read) |

The same URL renders different navigation and **blocks forbidden routes with an "Access denied" gate** — verified live for every persona in [Every role, captured](#-every-role-captured).

---

## 👑 Founder console (cross-tenant)

The founder console (`/founder/**`) is the platform control plane — manage every bank, its managers, platform users, cross-tenant analytics, and access control, then **drill into any single bank** to see its full compliance picture.

| Founder dashboard | Organizations (all banks) | Platform users |
|---|---|---|
| ![](docs/showcase/screenshots/founder/01-dashboard.png) | ![](docs/showcase/screenshots/founder/02-organizations.png) | ![](docs/showcase/screenshots/founder/04-users.png) |

| Managers | Access control | Cross-tenant analytics |
|---|---|---|
| ![](docs/showcase/screenshots/founder/03-managers.png) | ![](docs/showcase/screenshots/founder/05-access-control.png) | ![](docs/showcase/screenshots/founder/06-analytics.png) |

**Drill into a single bank** — the founder gets the same rich modules scoped to that tenant:

| Bank overview | Knowledge graph | Compliance Action Board |
|---|---|---|
| ![](docs/showcase/screenshots/founder/org-01-overview.png) | ![](docs/showcase/screenshots/founder/org-06-knowledge-graph.png) | ![](docs/showcase/screenshots/founder/org-05-map-board.png) |

<details>
<summary><b>More founder views (reports · audit trail · settings · per-bank obligations, drift, readiness, evidence, impact, security, users, teams, departments, access)</b></summary>

| Reports | Audit trail | Settings |
|---|---|---|
| ![](docs/showcase/screenshots/founder/07-reports.png) | ![](docs/showcase/screenshots/founder/08-audit-trail.png) | ![](docs/showcase/screenshots/founder/10-settings.png) |

| Obligations | Documents | Drift |
|---|---|---|
| ![](docs/showcase/screenshots/founder/org-02-obligations.png) | ![](docs/showcase/screenshots/founder/org-03-documents.png) | ![](docs/showcase/screenshots/founder/org-07-drift.png) |

| Readiness | Evidence | Impact |
|---|---|---|
| ![](docs/showcase/screenshots/founder/org-08-readiness.png) | ![](docs/showcase/screenshots/founder/org-09-evidence.png) | ![](docs/showcase/screenshots/founder/org-10-impact.png) |

| Security findings | Users | Teams |
|---|---|---|
| ![](docs/showcase/screenshots/founder/org-11-security-findings.png) | ![](docs/showcase/screenshots/founder/org-13-users.png) | ![](docs/showcase/screenshots/founder/org-14-teams.png) |

| Departments | Access | Audit (per bank) |
|---|---|---|
| ![](docs/showcase/screenshots/founder/org-15-departments.png) | ![](docs/showcase/screenshots/founder/org-16-access.png) | ![](docs/showcase/screenshots/founder/org-12-audit.png) |

</details>

---

## 🧭 The tenant workspace, module by module

Everything below was captured live in **Test Cooperative Bank** as a bank manager.

### 📥 Upload & Document intelligence
Drag in a circular and the pipeline ingests, parses and extracts obligations automatically.

| Upload | Documents |
|---|---|
| ![](docs/showcase/screenshots/manager/07-upload.png) | ![](docs/showcase/screenshots/manager/08-documents.png) |

### 🏛 Regulation Center & Obligations
A monitored inbox of regulator sources, and the obligations extracted from them.

| Regulation Center | Obligations |
|---|---|
| ![](docs/showcase/screenshots/manager/09-regulation-center.png) | ![](docs/showcase/screenshots/manager/10-obligations.png) |

### ✅ Compliance Action Board (MAPs)
AI suggests Measurable Action Points; managers govern with approve / reject / assign, drag across stages, and validation runs on items under review.

![](docs/showcase/screenshots/manager/11-map-board.png)

### 🕸 Knowledge Graph
The explainability layer — regulation → document → obligation → MAP → department → owner → evidence, with live updates.

![](docs/showcase/screenshots/manager/13-knowledge-graph.png)

### 🔀 Regulatory Change Analysis (Drift) & Readiness
Surface exactly what changed between circular versions, and score audit readiness.

| Drift | Readiness |
|---|---|
| ![](docs/showcase/screenshots/manager/14-drift.png) | ![](docs/showcase/screenshots/manager/15-readiness.png) |

### 📎 Evidence & ⚡ Impact
Collect audit evidence against each MAP, and simulate the operational impact of a change.

| Evidence | Impact analysis |
|---|---|
| ![](docs/showcase/screenshots/manager/16-evidence.png) | ![](docs/showcase/screenshots/manager/17-impact.png) |

### 🛡 Security Findings · 📊 Analytics · 📄 Reports · 🧾 Audit Trail

| Security findings | Risk & Analytics |
|---|---|
| ![](docs/showcase/screenshots/manager/18-security-findings.png) | ![](docs/showcase/screenshots/manager/22-analytics.png) |

| Reports | My tasks |
|---|---|
| ![](docs/showcase/screenshots/manager/19-reports.png) | ![](docs/showcase/screenshots/manager/12-my-tasks.png) |

### ⚙️ Administration (Users · Departments · Teams · Access · Settings)

| Users | Departments | Teams |
|---|---|---|
| ![](docs/showcase/screenshots/manager/23-admin-users.png) | ![](docs/showcase/screenshots/manager/24-admin-departments.png) | ![](docs/showcase/screenshots/manager/25-admin-teams.png) |

| Access control | Settings |
|---|---|
| ![](docs/showcase/screenshots/manager/26-admin-access.png) | ![](docs/showcase/screenshots/manager/21-settings.png) |

---

## 🎭 Every role, captured

Each persona below was logged in for real and crawled across every route — proving role-tailored navigation and the RBAC "Access denied" gate.

| Role | Signature view |
|------|----------------|
| **Compliance Analyst** — *Priya Shah* | ![](docs/showcase/screenshots/roles/compliance-analyst/02-dashboard-compliance.png) |
| **Security Team** — *Alex Chen* | ![](docs/showcase/screenshots/roles/security-team/18-security-findings.png) |
| **IT Owner** — *Sam Lee* | ![](docs/showcase/screenshots/roles/it-owner/11-map-board.png) |
| **Internal Auditor** — *Jordan Kim* | ![](docs/showcase/screenshots/roles/internal-auditor/04-dashboard-audit.png) |
| **Executive Viewer** — *Riley Park* | ![](docs/showcase/screenshots/roles/executive-viewer/03-dashboard-executive.png) |

> Full per-role galleries (every accessible tab for every persona) live under [`docs/showcase/screenshots/roles/`](docs/showcase/screenshots/roles/).

---

## 🧱 Tech stack

| Layer | Technology |
|------|------------|
| **Framework** | Next.js 16 (App Router, Turbopack), React 19, TypeScript 5 |
| **UI** | Tailwind CSS v4, Framer Motion, Recharts, `@xyflow/react` (knowledge graph), Zustand, shadcn-style primitives |
| **Data** | Supabase — PostgreSQL + Row-Level Security + `pgvector`, Storage, Auth/JWT |
| **Agent service** | Python · FastAPI · **Google ADK** · `google-genai` · **LiteLLM** · APScheduler · `pdf-parse` ingestion |
| **LLM** | Gemini 2.5 Flash (cloud) **or** Ollama `llama3.2` (offline, via LiteLLM) |
| **Auth model** | RBAC (route/nav) + ABAC (department scope) + Postgres RLS (rows) |

---

## 🗃 Data model

Core tenant-scoped tables the agents read and write (all keyed by `organization_id`):

`organizations` · `profiles` · `memberships` · `departments` · `teams` · `regulatory_sources` · `regulatory_changes` · `documents` · `obligations` · `map_cards` · `escalations` · `evidence` · `readiness_scores` · `drift_comparisons` · `impact_simulations` · `audit_trail` · `audit_exports` · `agent_runs` · `agent_events` · regulation embeddings (`pgvector`).

Schema and incremental migrations live in [`supabase/migrations/`](supabase/migrations/).

---

## 🚀 Getting started

### Prerequisites
- Node.js 20+ and npm
- A Supabase project (URL, anon key, service-role key)
- *(For agents)* Python 3.11+ and either a Gemini API key **or** Ollama running locally

### 1) The web app

```bash
npm install
cp .env.example .env.local   # fill in Supabase + agent settings
npm run dev                  # http://localhost:3000
```

### 2) The agent service

```bash
cd agent-service
python -m venv .venv
.venv\Scripts\activate        # Windows  (use: source .venv/bin/activate on macOS/Linux)
pip install -r requirements.txt
# configure agent-service/.env (GEMINI_API_KEY or SURAKSHA_USE_LOCAL_LLM=true, SUPABASE_*, AGENT_SHARED_SECRET)
uvicorn app.main:app --port 8088
```

Point the app at the service via `AGENT_SERVICE_URL` and `AGENT_SHARED_SECRET` in `.env.local` (they must match the service's `.env`). The founder dashboard and **Agents** page will then show the backend as **Online**.

> **Never commit real credentials.** `.env`, `.env.local`, and `agent-service/.env` are git-ignored.

### 3) Hugging Face demo deployment

This repo includes a Docker Space setup (`Dockerfile`) and a GitHub Actions workflow (`.github/workflows/deploy-huggingface.yml`) that publishes the demo to Hugging Face Spaces. The Docker Space runs the Next.js app on port `7860` and the Python FastAPI agent service internally on `127.0.0.1:8088`.

See [`docs/HUGGINGFACE_DEPLOYMENT.md`](docs/HUGGINGFACE_DEPLOYMENT.md) for the required `HF_TOKEN`, `HF_SPACE_ID`, Supabase, and optional agent-service secrets. The live app URL will be `https://huggingface.co/spaces/<owner>/<space-name>` and the direct runtime URL will be `https://<owner>-<space-name>.hf.space`.

---

## 🎬 Reproducing this showcase

Every screenshot, the GIF, and the MP4 in this README are generated by one script that logs in as each persona, crawls every route, exercises tabs/dialogs, and records a guided demo video:

```bash
npm run dev                          # production build also works: next build && next start
node scripts/showcase-capture.cjs    # → docs/showcase/screenshots + docs/showcase/video
```

It uses Playwright for capture and a bundled `@ffmpeg-installer/ffmpeg` binary to produce the MP4 + slideshow GIF — no global tooling required.

---

## 🔒 Security

- **Authentication** on every non-public route and API (`Authorization: Bearer …`), enforced by the edge proxy.
- **RBAC + ABAC + Postgres RLS** — three independent layers; the UI gate is a convenience, the database is the source of truth.
- **Tenant isolation** by `organization_id` on every query and every agent task.
- **Secret-scoped agent service** — mutating endpoints require a shared `X-Agent-Secret`.
- **Audit-logged** — agent and user actions land in `audit_trail` / `agent_events` with full provenance.

---

## 📄 License

Released under the **Apache License 2.0** — see [`LICENSE`](LICENSE). You are free to use, modify, and distribute this work with attribution; it is provided "as is", without warranty.

---

<div align="center">

**Suraksha OS** — *compliance that runs itself.*

</div>
