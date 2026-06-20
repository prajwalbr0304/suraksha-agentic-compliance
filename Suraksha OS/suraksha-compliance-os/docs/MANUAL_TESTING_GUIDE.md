# Suraksha OS — Complete Manual Testing Guide

This guide walks a tester from **zero** through **new bank + manager + departments**, **document upload**, **every major product area**, and **AI agents** (Google ADK / Gemini via the Python **agent-service**). It matches the current app behavior in `suraksha-compliance-os`.

---

## Part A — Environment and services

### A.1 What must be running

| Service | Command / notes |
|--------|------------------|
| **Next.js app** | From repo root: `npm run dev` → usually `http://localhost:3000` |
| **Supabase** | Cloud project or local; `.env.local` must have `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, bucket name `NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET` (default bucket name used in code: `compliance-documents`) |
| **Agent service** (for agents end-to-end) | From `agent-service/`: Python venv + `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_SHARED_SECRET` aligned with the Next app |

### A.2 Next.js env (app)

Set in **`.env.local`** (see `.env.example`):

- `AGENT_SERVICE_URL` — default in code is `http://localhost:8088` if unset  
- `AGENT_SHARED_SECRET` — **must match** the value in `agent-service/.env`  
- `SURAKSHA_AUTH_REQUIRED=true` (recommended)

### A.3 Agent-service env

Typical `agent-service/.env`:

- `GEMINI_API_KEY` — required for real LLM runs (health shows `llm_configured`)  
- `SUPABASE_URL` — same project as the app  
- `SUPABASE_SERVICE_ROLE_KEY` — service role (server-side writes)  
- `AGENT_SHARED_SECRET` — same string as Next’s `AGENT_SHARED_SECRET`  
- `AGENT_PORT=8088` (default)

Start:

```bash
cd agent-service
# activate venv, then:
uvicorn app.main:app --host 0.0.0.0 --port 8088
```

### A.4 Test accounts

If you use **`node scripts/seed-enterprise.cjs`** (recommended once per DB):

| Persona | Email (default seed) | Password |
|--------|----------------------|----------|
| Founder | `founder@suraksha.local` | `SurakshaFounder@2026` |

For a **brand-new bank**, you will create a **new manager email + password** in Part B (no seed required for that user beyond Supabase Auth user creation done by the API).

### A.5 Migrations

Ensure all SQL migrations are applied to your Supabase project (including tenant isolation). If you use the repo script: `SUPABASE_DB_PASSWORD=... node scripts/apply-enterprise-migrations.cjs` (as documented in your ops runbook).

---

## Part B — Create a new bank and first Bank Manager (Founder)

**Actor:** Platform **Founder** only (`founders` table).

### B.1 Log in as Founder

1. Open `/login`.  
2. Sign in with the founder account (e.g. seed `founder@suraksha.local`).  
3. You should land directly on **`/founder`** (Founder Dashboard): KPIs, per-bank table, agent health card — login resolves your role via **`/api/me`** before navigation, so you should not see the tenant **Executive Dashboard** flash first.

**Pass criteria:** Page title “Founder Dashboard”; no repeated errors in UI; optional link “Open agents” works.

### B.2 Create a new bank (organization)

1. Go to **`/founder/organizations`** (sidebar: **Organizations**).  
2. Click **Create bank**.  
3. Fill the form (required fields enforced by API):

   - **Bank name** * (e.g. `Test Cooperative Bank`)  
   - **Region** (optional)  
   - **License no.** (optional)  
   - **Manager full name** (optional; defaults to “Bank Manager” if omitted)  
   - **Manager email** * — use a **fresh** address you control, e.g. `manager.testbank@yourdomain.com`  
   - **Manager password** * — strong temp password you will hand to the manager user  

4. Submit **Create bank + manager**.

**What the backend does (for your verification in DB or UI later):**

- Inserts a row in **`organizations`**.  
- Inserts **8 default departments** for that org: *Compliance, Risk Management, IT, Security, Operations, Internal Audit, Finance, Legal* (see `app/api/founder/banks/route.ts`).  
- Creates the **Auth user** and **`organization_members`** row with role **`bank_manager`**.

**Pass criteria:** Toast success; new bank appears in the table; status **active**.  
**Partial success (HTTP 207):** Bank row exists but response says manager creation failed — fix Auth/duplicate email and retry (document the error JSON).

### B.3 Open the new tenant (Founder drill-down)

1. In the organizations table, click the **bank name** or **Open** for the new bank.  
2. URL should be **`/founder/organizations/<uuid>`** — tenant overview for that bank.  
3. **Edit bank manager:** Under **Bank manager**, click **Edit login & password** to update the manager’s **email**, **password** (min 8 characters), and optional **display name** (uses `PATCH /api/founder/banks` with `organization_id`).

**Pass criteria:** Header shows the **bank name**; cards show compliance score / counts when data exists; credential edits save and the listed manager email updates after refresh.

> **Note for founders:** Tenant APIs use org context (`TenantApiProvider` + `x-suraksha-org-id`). The drill-down UI wires this for child routes under `/founder/organizations/[orgId]/...`.

**Tenant URLs (bank users):** After login, main modules live under **`/dashboard/{organizationSlug}/…`** (e.g. `…/documents`, `…/knowledge-graph`, `…/compliance`) so the address bar matches the active bank. Legacy paths like `/documents` redirect to the slugged URL automatically.
---

## Part C — Log in as the new Bank Manager

### C.1 First login

1. Sign **out** from Founder (top nav **Sign out**).  
2. Log in with **manager email + password** you set in Part B.  
3. The app resolves your role via **`/api/me`** and navigates to your home route (you should land on **`/dashboard/{organizationSlug}/compliance`** — URL-safe slug from your bank — without first flashing the generic Executive Dashboard). The **top bar** shows the **bank display name** and slug so the active tenant is obvious.

**Pass criteria:** Sidebar shows **Bank Manager** menu: Dashboard, Upload, Documents, Obligations, Compliance Action Board, Knowledge Graph, Regulatory Change Analysis, Readiness, Evidence, Compliance Impact Analysis, Security Findings, Reports, Audit Trail, Agents, Users, Departments, Teams, Access Control, Settings.

### C.2 Confirm default departments exist

1. Open **`/admin/departments`**.  
2. You should see **8** departments seeded at bank creation.

**Pass criteria:** List matches default set. Each card shows **edit** (pencil) and **remove** (trash) actions for managers with `departments.manage`.

### C.3 (Optional) Create, edit, or remove a department

1. **Create:** **New Department** — name e.g. `Treasury`, optional head/email, **risk level**; submit.  
2. **Edit:** Pencil on a card — change fields → **Save changes**; list should refresh with updates.  
3. **Remove:** Trash → confirm. If any **active** user is still assigned to that department name in **Users**, the API returns **409** (reassign in **Users** first, then delete).  
4. **DB:** Apply migration **`020_department_deleted_audit.sql`** so delete audits use action `department_deleted` (enterprise migration list includes it).

**Pass criteria:** Create/edit/remove behave as above; no cross-org leakage (only this bank’s list).

### C.4 (Optional) Teams and extra users

1. **`/admin/teams`** — **New Team** (e.g. SOC under Security). **Edit** (pencil) renames or moves department; **Remove** (trash) fails with **409** while **active** users have that team in **Users → Edit** (reassign team first). Apply migration **`021_team_updated_deleted_audit.sql`** for `team_updated` / `team_deleted` audit actions.  
2. **`/admin/users`** — **New User** (email, temp password, role; optional department + **team**). **Edit** opens a modal for **full name**, department, team, and **status** (reactivate suspended users) for other users. **Bank manager** on their **own** row: display name, **department**, and **team** are read-only (no self-service reassignment); **Save** is disabled unless a **founder** is updating that row’s manager **login email/password**. **Founder** drilling into the bank (`x-suraksha-org-id`): for the **bank manager** row, the modal can include **login email** and optional **new password** (min 8 chars). Inline **role** dropdown remains for quick changes; **Deactivate** removes access (soft).  

**Pass criteria:** Teams and users create/edit/remove rules behave as above; role/status self-protection still holds (API **403** / disabled controls for your own row). **Bank manager** editing their own row: display name, department, and team are read-only; login fields are absent for managers; a **founder** in org context can set the bank manager **email/password** on that row only.

---

## Part D — Upload documents

**Route:** `/upload`  
**API:** `POST /api/upload-document` (multipart `file`; permission `documents.upload`).

### D.1 Prepare a file

Use a **supported type**: PDF (preferred), DOC/DOCX, PNG/JPEG/TIFF (see upload route `ACCEPTED_MIME`).

Keep under **50 MB**.

### D.2 Upload

1. As **Bank Manager**, go to **Upload**.  
2. Drag/drop or pick the file; wait until queue shows **completed** / **processing** as designed.

**Pass criteria:** No 401/403; document row appears under **`/documents`** → **Uploaded documents** tab (Document Repository) with status progressing from queued → processing → processed (exact timing depends on background processing / extraction path).

### D.3 Documents list

1. Open **`/documents`**.  
2. Use tabs **Regulatory feed** vs **Uploaded documents**; verify **name, size, status**, obligation count if extraction ran.

**If extraction is agent-driven:** Obligations often appear after **Run compliance automation** or **Monitor feeds** processes regulatory or document-derived **changes** (see Part F). The legacy **local Ollama** path is **off** unless `ENABLE_LOCAL_EXTRACTION=1`.

---

## Part E — Feature-by-feature manual checks

Use **Bank Manager** (or the extra user with the right role) unless noted.

### E.1 Compliance command center

- **`/dashboard`** may redirect by role; manager lands on **`/dashboard/{organizationSlug}/compliance`** (legacy **`/dashboard/compliance`** redirects to the same tenant-scoped URL).
- **Check:** Hero metrics, **AI activity stream**, and department risk overview load; **Run compliance automation** opens a live step modal; error state has **Retry** if data fails.

### E.2 Obligations

- **`/obligations`**  
- **Check:** Table loads; **Add Obligation** (if permitted); **Export CSV** downloads; edit/delete guarded by role.  
- **API reality:** List is org-scoped; founders need org header on APIs (UI handles drill-down).

### E.3 Compliance Action Board

- **`/map-board`**  
- **Check:** Columns or cards by status; create/update status if UI allows; assignments visible.

### E.4 Evidence

- **`/evidence`**  
- **Check:** Stats strip; list links to obligations/MAP context as designed.

### E.5 Readiness

- **`/readiness`**  
- **Check:** Department scores; **Recompute** triggers API (may return quickly; agent also recomputes after validation — Part F).

### E.6 Regulatory Change Analysis

- **`/drift`**  
- **Check:** Select two documents/circulars (per UI); run comparison; result row in DB/UI when agent Drift path ran (needs ≥2 documents for auto drift in coordinator — Part F).

### E.7 Compliance Impact Analysis

- **`/impact`**  
- **Check:** Simulations list; empty state if none until agent **Impact** runs with at least one document.

### E.8 Security Findings

- **`/security-findings`**  
- **Check:** Integration findings list; filters if present.

### E.9 Knowledge Graph

- **`/knowledge-graph`**  
- **Check:** Graph renders; pan/zoom; no hard crash on empty graph.

### E.10 Reports

- **`/reports`**  
- **Check:** Report sections load via BFF; export control if visible.

### E.11 Analytics (role-gated)

- **`/analytics`** — visible for roles in `data/mock-data.ts` (e.g. compliance_admin, founder path includes link).  
- **Check:** Charts and totals match org (not another bank).

### E.12 Audit Trail

- **`/audit`**  
- **Check:** Rows appear for actions you took (upload, map changes, bank creation may appear as founder in founder audit context — verify actor and message).

### E.13 Notifications

- Top nav **bell** — open panel.  
- **Check:** Mark read / counts update (depends on seeded or generated notifications).

### E.14 Access Control

- **`/admin/access`** (manager)  
- **Check:** Grant/revoke a non-dangerous permission on a **non-founder** test user; confirm **cannot** grant `admin.all` or modify founder (403).

### E.15 Settings

- **`/settings`**  
- **Check:** Loads for permitted roles; save if fields exist.

---

### F.0 Scratch testing: empty compliance data + migrations

1. **Apply DB migration `023_regulatory_pdf_ingestion.sql`** once on your Supabase project (included in `node scripts/apply-enterprise-migrations.cjs` if you run the full 013–023 bundle). Required for agent writes to `resolved_pdf_url` / `pdf_storage_path` / `ingestion_error` on `regulatory_changes`.
2. **Wipe all tenant compliance rows** (keep orgs, users, departments, teams, feed subscriptions): from repo root, `npm run db:clear-all-compliance -- --yes` with `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
3. **Agent-service env:** align `NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET` with the Next app; optional `SURAKSHA_REGULATORY_FEED_SAMPLES=true` only for offline demos; `AUTOMATIC_PDF_STRICT=true` if you require a real PDF for every processed change.

## Part F — Agents: how they work and how to test them

**UI:** `/agents` (Agent Control Center).  
**Next API:** `POST /api/agents/runs` with JSON `{ "pipeline": "watch" | "full" | "validate" }` — requires permission **`obligations.create`** and a resolved **`organizationId`** (bank users: automatic; founders: must be in tenant context with org header).

**Downstream:** Next proxies to **`POST {AGENT_SERVICE_URL}/runs`** with header **`X-Agent-Secret: AGENT_SHARED_SECRET`** and body `{ organization_id, pipeline }`.

### F.1 Health and feeds (before any run)

1. On **`/agents`**, read **Agent service** card.  
   - **Online · &lt;model&gt;** → Next could reach `GET /health` on agent-service and Gemini is configured.  
   - **Unreachable** → start agent-service; fix `AGENT_SERVICE_URL` / firewall.

2. **Regulatory changes** list is from Supabase **`regulatory_changes`** (org-scoped for non-founders).

### F.2 Pipeline: **Scan feeds** (`watch`)

**Button:** **Scan feeds** (Agents page)  
**Meaning:** Runs **`MonitoringAgent`** — `pipeline.watch_organization`: fetches regulatory **RSS/feeds** for this `organization_id`. The agent service returns **HTTP 202** with `{ "accepted": true, "run_id", "pipeline": "watch" }` and completes in a **background task** (same pattern as `full` / `validate`). With default env, **no synthetic feed items** are injected on failure (`SURAKSHA_REGULATORY_FEED_SAMPLES=false`). When a notification page exposes a PDF link, **`process_change`** (during a **full** run) downloads the PDF to Supabase Storage, extracts text with **pypdf** (digital PDFs only; scanned PDFs fall back to RSS summary with `needs_ocr` in document metadata), then runs the obligation extractor.

**How to test:**

1. Click **Scan feeds**; you should get an immediate toast; completion toast when the run finishes (polls in background).  
2. Refresh page: **Regulatory feed (detected)** should show new rows or “No changes” with explanation.

**Pass:** HTTP **202** from the proxy (no 502); **`agent_runs`** shows a coordinator row with `stats.pipeline` = `watch` and `agent_events` includes feed scan messages.

### F.3 Pipeline: **Run compliance automation** (`full`)

**Button:** **Run compliance automation**  
**Meaning:** **`CoordinatorAgent.run_full`** (see `agent-service/app/coordinator.py`):

1. **MonitoringAgent** — same as watch (scan feeds).  
2. For **each new change**: **ObligationAgent** + **MapAgent** + **RoutingAgent** via `pipeline.process_change` — creates/updates **obligations**, **map_cards**, may create **escalations** (e.g. cyber-related routing to Security).  
3. **DriftAgent** — if at least **two** recent documents exist, writes **`drift_comparisons`**.  
4. **ImpactAgent** — if at least **one** document exists, writes **`impact_simulations`**.  
5. **AuditAgent** — summarizes recent automation events into **`audit_exports`** / audit trail entries.

**How to test (recommended order):**

1. Ensure **Part D** uploaded **at least one** PDF so Impact has material (Drift needs **two**).  
2. Click **Run compliance automation**; wait (can take **minutes**; Next allows long timeout).  
3. Verify in UI:  
   - **`/obligations`** — new rows if changes were processed.  
   - **`/map-board`** — new MAP cards (Compliance Action Board).  
   - **`/drift`** — comparison if ≥2 docs.  
   - **`/impact`** — simulation if ≥1 doc.  
   - **`/audit`** — new **agent** / export related entries.  
4. **`/agents`** — **Agent Runs** list: parent **coordinator** run **completed** (or failed with summary).

**Fail triage:** 502 → agent down or secret mismatch; 403 → role missing `obligations.create`; stuck → check agent-service logs and `GEMINI_API_KEY`.

### F.4 Pipeline: **Validate compliance evidence** (`validate`)

**Button:** **Validate compliance evidence**  
**Meaning:** **`CoordinatorAgent.run_validate`** — **EvidenceAgent** runs `pipeline.run_validator` over open MAPs/evidence; may mark items validated/completed and **recompute readiness** for affected departments; **AuditAgent** summary at end.

**How to test:**

1. Have at least one **open/in progress MAP** with evidence paths (from Run compliance automation or manual data).  
2. Click **Validate compliance evidence**.  
3. Check **`/readiness`** scores and **`/evidence`** statuses after completion.

### F.5 Sub-agents vs buttons (mapping)

| Product name | Code / behavior | When it runs |
|--------------|-----------------|----------------|
| Monitoring Agent | `watch_organization` | **Monitor feeds** or start of **Run compliance automation** |
| Obligation Agent | Part of `process_change` | **Run compliance automation** per regulatory change |
| MAP Agent | Part of `process_change` | **Run compliance automation** |
| Routing Agent | Escalations / department assignment in `process_change` | **Run compliance automation** |
| Evidence Agent | `run_validator` | **Validate compliance evidence** (and scheduled job if enabled) |
| Drift Agent | `_run_drift` | **Run compliance automation** (needs 2 docs) |
| Impact Agent | `_run_impact` | **Run compliance automation** (needs 1 doc) |
| Audit Agent | `_run_audit` | End of **Run compliance automation** and **Validate compliance evidence** |

### F.6 Scheduled autonomy (optional)

If `ENABLE_SCHEDULER=1` in agent-service, **watch** and **validate** jobs run on an interval for **all** orgs with activity. Verify only in non-prod or with consent — long-running and billable (Gemini).

---

## Part G — Founder cross-checks (isolation)

Still as **Founder**:

1. **`/founder`** — per-bank analytics table counts should **not** mix banks incorrectly.  
2. Open **another** bank from Organizations; confirm modules under **`/founder/organizations/<id>/...`** only show **that** bank’s data.  
3. Optional API check: without org header, **`GET /api/obligations`** as founder should **fail** (400) — by design to prevent silent cross-tenant reads.

---

## Part H — Regression script (order of execution)

Run this in one session for a full smoke:

1. Founder: create bank + manager (Part B).  
2. Manager: confirm departments (Part C.2).  
3. Manager: upload PDF (Part D).  
4. Start agent-service + confirm health (Part F.1).  
5. Manager: **Monitor feeds** → **Run compliance automation** → **Validate compliance evidence** (Part F).  
6. Manager: walk E.2–E.14 quickly.  
7. Founder: cross-tenant checks (Part G).  
8. Run automated **`node scripts/enterprise-audit.cjs`** (with app running) if configured in your environment.

---

## Part I — After teams & users are created (persona walkthrough)

Use this when **Part C.4** is done (teams + users exist). Sign **out** between personas (top nav **Sign out**). URLs should stay under **`/dashboard/{organizationSlug}/…`** for bank users.

**Before you start:** Confirm **Part A** (Next + Supabase). For agents, **Part F** needs **agent-service** running and secrets aligned.

### I.0 Smoke as Bank Manager (once)

1. Log in as **Bank Manager** (Part B credentials).  
2. Open **Users** and **Teams** — confirm your five users and five teams appear.  
3. Do **Part D** (upload at least one small **PDF**) so later steps (Drift, Impact, agents) have material.  
4. Optional but recommended: **Part F.1–F.3** (agent health → **Monitor feeds** → **Run compliance automation**) while still manager.

### I.1 Persona order and what to exercise

| Order | Log in as | Home route (typical) | Focus (see Part E / F) |
|------|-----------|----------------------|-------------------------|
| 1 | **Priya Shah** `priya.shah@yourbank.test` — **Compliance Analyst** | `…/compliance` | **E.1** Command center · **E.2** Obligations · **E.3** Compliance Action Board · **E.4** Evidence · **E.6** Regulatory Change Analysis · **E.7** Compliance Impact Analysis · **E.9** Knowledge Graph · **E.10** Reports · **D** Upload (if role allows) · **F** Agents if UI shows buttons (needs `obligations.create` — if **403**, use manager for agent runs only) |
| 2 | **Alex Chen** `alex.chen@yourbank.test` — **Security Team** | `…/security` | **E.8** Security Findings · **E.3** MAP (read/update as UI allows) · **E.4** Evidence · Confirm **department** = Security / team **SOC** in profile or Users list |
| 3 | **Sam Lee** `sam.lee@yourbank.test` — **IT Owner** | `…/security` | Same security-area modules as Alex; **IT** / **IAM Squad** assignment |
| 4 | **Jordan Kim** `jordan.kim@yourbank.test` — **Internal Auditor** | `…/audit` | **E.12** Audit Trail · **E.10** Reports · **E.9** Knowledge Graph · **E.2** read-focused checks |
| 5 | **Riley Park** `riley.park@yourbank.test` — **Executive Viewer** | `…/executive` | **E.1**-style KPIs (executive) · **E.10** Reports · **E.11** Analytics — mostly read-only; no admin users/teams |

**Pass (each persona):** Login succeeds; URL shows your **bank slug**; sidebar matches role (no **Users/Teams** for non-managers unless role allows); no unexpected **403** on pages that role should see; data looks **only** for this bank (compare counts with manager).

### I.2 Department / team sanity checks

- In **`/admin/users`**, open **Edit** on each user: **department** must match one of the eight defaults exactly (e.g. **Compliance**, not `compliance`).  
- **Team** should match what you created (or **(none)** for Jordan).  
- If **Compliance Action Board** or **Obligations** is empty for a department-scoped role, that can be expected until **Part F** created data or assignments include that department.

### I.3 Optional founder re-check

**Part G** — confirm a second bank (if any) does not leak into this bank’s numbers.

---

## Appendix — Quick troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| 502 on agent buttons | Agent not running; wrong `AGENT_SERVICE_URL`; wrong secret |
| Gemini / LLM errors | Missing `GEMINI_API_KEY`; quota; model name |
| Upload 403 | User lacks `documents.upload` or not a member of org |
| Empty obligations after Full | No new `regulatory_changes` processed; or LLM returned empty — check `agent_events` / logs |
| Clear one bank’s demo/docs/obligations | Run `npm run db:clear-org -- <organization-slug> --yes` (requires `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`). Removes org-scoped documents (incl. storage), obligations, MAP/evidence, agent runs, regulatory changes, drift/impact, KPI rows, notifications, audit trail for that org — **not** users/teams/departments. |
| Founder sees empty tenant module | Not under org drill-down / missing org header on API |

---

*Document version: aligned with coordinator + founder bank creation in-repo. Update if routes or env names change.*
