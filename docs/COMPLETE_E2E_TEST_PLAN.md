# Suraksha OS — Complete End-to-End Test Plan

**Scope:** Every dashboard, every page, every API route, every role, every flow — UI + frontend + backend + database + authorization (RBAC/ABAC/RLS) + realtime — with **positive** and **negative** scenarios. Nothing is skipped.

**App URL:** `http://localhost:3000`
**Run dev server:** `npm run dev`
**Automated mirror of this document:** `npm run test:e2e:full` (script: `scripts/e2e-complete-suite.cjs`)

> This document is intentionally exhaustive. It is the source of truth that the automated suite mirrors section-by-section. Each numbered case has an explicit **Expected** result so it can be both manually executed and machine-verified.

---

## 0. System Model (read first)

### 0.1 Roles and demo accounts

| # | Role (DB) | Label | Demo email | Password | Landing dashboard |
|---|-----------|-------|------------|----------|-------------------|
| 1 | `org_admin` | Organization Admin | `admin@suraksha.local` | `SurakshaAdmin@2026` | `/dashboard` |
| 2 | `compliance_admin` | Compliance Admin | `compliance@suraksha.local` | `SurakshaCompliance@2026` | `/dashboard/compliance` |
| 3 | `security_team` | Security Team | `security@suraksha.local` | `SurakshaSecurity@2026` | `/dashboard/security` |
| 4 | `internal_auditor` | Internal Auditor | `audit@suraksha.local` | `SurakshaAudit@2026` | `/dashboard/audit` |
| 5 | `executive_viewer` | Executive Viewer | `executive@suraksha.local` | `SurakshaExecutive@2026` | `/dashboard/executive` |
| 6 | `department_owner` | Department Owner | `owner@suraksha.local` | `SurakshaOwner@2026` | `/dashboard/team` |

Additional roles defined in the system but without seeded demo logins: `platform_admin` (has `admin.all`), `compliance_analyst`, `it_owner`, `external_auditor`.

### 0.2 Permission matrix (DB `role_permissions`)

| Permission | platform_admin | org_admin | compliance_admin | compliance_analyst | security_team | it_owner | department_owner | internal_auditor | executive_viewer | external_auditor |
|------------|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `admin.all` | ✅ | | | | | | | | | |
| `settings.manage` | ✅ | ✅ | | | | | | | | |
| `users.manage` | ✅ | ✅ | | | | | | | | |
| `documents.read` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `documents.upload` | ✅ | ✅ | ✅ | ✅ | | | | | | |
| `documents.delete` | ✅ | ✅ | ✅ | | | | | | | |
| `obligations.create` | ✅ | ✅ | ✅ | ✅ | ✅ | | | | | |
| `obligations.assign` | ✅ | ✅ | ✅ | | | | | | | |
| `obligations.approve` | ✅ | ✅ | ✅ | | | | | | | |
| `evidence.create` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | | | |
| `evidence.approve` | ✅ | ✅ | ✅ | | | | | | | |
| `reports.export` | ✅ | ✅ | ✅ | ✅ | | | | ✅ | ✅ | ✅ |
| `audit.read` | ✅ | ✅ | ✅ | | | | | ✅ | | ✅ |
| `security.findings.read` | ✅ | ✅ | | | ✅ | ✅ | | | | |

> **org_admin oversight (migration 010):** `org_admin` now has full organization oversight (all read + manage permissions, short of platform `admin.all`). Its generic `/dashboard` shows live data. (Before migration 010 it lacked `documents.read` and saw 403s.)
>
> **Settings nuance (test it):** `settings.manage` is only on `org_admin` (and `platform_admin`). `compliance_admin` can **open** Settings (`GET /api/settings` needs `documents.read`) but **saving** (`PATCH /api/settings`) requires `settings.manage` → compliance_admin **save** returns **403**, and the Settings UI **disables the Save button** for such roles with a "Only Organization Admin can change settings" notice.

### 0.3 API surface (method → required permission → notable behavior)

| Endpoint | Method | Permission | Negative behaviors to verify |
|----------|--------|-----------|------------------------------|
| `/api/me` | GET | (any authenticated) | No token → 401 |
| `/api/documents` | GET | `documents.read` | No token → 401; missing perm → 403 |
| `/api/documents` | DELETE | `documents.delete` | `?id=` required |
| `/api/documents/[id]/download` | GET | `documents.read` | Unknown id → 404; cross-org → 403/404 |
| `/api/obligations` | GET | `documents.read` | org-scoped + ABAC row filter |
| `/api/obligations` | POST | `obligations.create` | missing title/department → 400 |
| `/api/obligations/[id]` | GET | `documents.read` | unknown id → 404 |
| `/api/obligations/[id]` | PUT | `obligations.assign` | unknown id → 404 |
| `/api/obligations/[id]` | DELETE | `obligations.assign` | unknown id → 404 |
| `/api/map-cards` | GET | `documents.read` | — |
| `/api/map-cards` | POST | `obligations.create` | missing title → 400; missing obligation_id → 400; foreign obligation_id → 403 (IDOR) |
| `/api/map-cards/[id]` | PUT | `obligations.assign` | unknown id → 404 |
| `/api/map-cards/[id]` | DELETE | `obligations.assign` | unknown id → 404 |
| `/api/evidence` | GET | `documents.read` | foreign obligation_id → 403 |
| `/api/evidence` | POST | `evidence.create` | missing fields → 400; foreign obligation → 403 |
| `/api/evidence` | PUT | `evidence.create` | missing `?id=` → 400; unknown → 404 |
| `/api/evidence-intelligence` | GET | `documents.read` | — |
| `/api/evidence-intelligence` | POST | `evidence.create` | — |
| `/api/drift` | GET | `documents.read` | — |
| `/api/drift` | POST | `obligations.create` | missing ids → 400; foreign doc → 403 (IDOR) |
| `/api/impact` | GET | `documents.read` | — |
| `/api/impact` | POST | `obligations.create` | missing document_id → 400; foreign doc → 403 (IDOR) |
| `/api/knowledge-graph` | GET | `documents.read` | — |
| `/api/readiness` | GET | `documents.read` | — |
| `/api/notifications` | GET | `documents.read` | — |
| `/api/notifications` | PATCH | `documents.read` | mark read |
| `/api/notifications` | POST | `settings.manage` | only org/platform admin; missing fields → 400 |
| `/api/ai-pipeline` | GET | `documents.read` | returns capabilities + review queue |
| `/api/extract-obligations` | GET | `documents.read` | — |
| `/api/extract-obligations` | POST | `obligations.create` | non-multipart → 400 |
| `/api/upload-document` | POST | `documents.upload` | non-multipart/invalid → 400 |
| `/api/integrations/security-findings` | GET | `security.findings.read` | compliance_admin → 403 |
| `/api/integrations/security-findings` | POST | `security.findings.read` | import upsert |
| `/api/settings` | GET | `documents.read` | — |
| `/api/settings` | PATCH | `settings.manage` | compliance_admin → 403 |
| `/api/admin/migrate` | GET/POST | `settings.manage` | — |

### 0.4 Sidebar navigation visibility (RBAC at UI)

`null` personas = visible to everyone authenticated.

| Route | Visible to roles |
|-------|------------------|
| `/dashboard` | all |
| `/documents` | all |
| `/readiness` | all |
| `/upload` | platform_admin, org_admin, compliance_admin, compliance_analyst |
| `/obligations` | + security_team, department_owner |
| `/map-board` | + security_team, it_owner, department_owner |
| `/knowledge-graph` | platform/org/compliance admin, compliance_analyst, internal_auditor |
| `/drift` | platform/org/compliance admin, compliance_analyst |
| `/evidence` | broad: admins, analyst, security_team, it_owner, department_owner, internal_auditor, external_auditor |
| `/impact` | admins, compliance_analyst, executive_viewer |
| `/audit` | platform/org/compliance admin, internal_auditor, external_auditor |
| `/security-findings` | platform/org/compliance admin, security_team, it_owner |
| `/analytics` | platform/org/compliance admin, internal_auditor, executive_viewer |
| `/reports` | admins, analyst, internal_auditor, executive_viewer, external_auditor |
| `/settings` | platform_admin, org_admin, compliance_admin |

> Direct-URL guard: visiting a route whose `personas` list excludes the current role shows the **"Access denied"** screen (with "Go to dashboard"). Routes with `null` personas are never blocked by the shell guard (API still enforces permissions).

### 0.5 How dashboards interrelate (data lineage)

```
Upload (PDF) ──► /api/upload-document ──► documents table
        │                                      │
        ▼                                      ▼
  AI extraction (Ollama) ──► obligations ◄── document_id
        │                         │
        │            ┌────────────┼──────────────┬───────────────┐
        ▼            ▼            ▼               ▼               ▼
   evidence     map_cards    drift(2 docs)   impact(1 doc)   knowledge-graph
        │            │            │               │               │
        └──────┬─────┴─────┬──────┴───────┬───────┘               │
               ▼           ▼              ▼                        ▼
          readiness    audit_trail   analytics/reports     graph relationships
               │           │              │
               ▼           ▼              ▼
         dashboards (executive / compliance / security / audit / team / generic)
```

- **Dashboard KPIs** (`useDashboard`) are computed from `obligations`, `documents`, `map_cards`.
- **Audit trail** receives a row on every mutation (obligation/evidence/map create/update/delete, upload, security import) → feeds **Audit dashboard**, **Analytics activity**, **Compliance recent activity**.
- **Readiness** recomputes from obligation status + evidence collection → feeds **Executive risk** and **Audit at-risk** sections.
- **Escalations** (`useEscalations`) feed **Executive** + **Compliance** dashboards.
- **Security findings** import → **Security dashboard** + **Security Findings** page.

---

## Part A — Authentication & Session

### A1. Root redirect (positive)
1. Open `http://localhost:3000/` logged out.
2. **Expected:** redirect to `/login`.

### A2. Protected route while logged out (negative)
1. Open `http://localhost:3000/dashboard` logged out.
2. **Expected:** "Checking secure session…" then redirect to `/login`.

### A3. Invalid credentials (negative)
1. On `/login`, enter `wrong@email.com` / `wrongpass`.
2. **Expected:** red error banner ("Invalid login credentials"); stays on `/login`.

### A4. Empty form submit (negative)
1. Submit with empty email/password.
2. **Expected:** native HTML required-field validation blocks submit.

### A5. Login per role (positive ×6)
For each of the 6 demo accounts:
1. Enter credentials, click **Sign in to workspace**.
2. **Expected:** success animation → redirect to the role's landing dashboard (table 0.1).
3. **Expected:** top-right shows correct **role label**; sidebar shows only allowed items (table 0.4).

### A6. Password visibility toggle (positive)
1. Type a password, click the eye icon.
2. **Expected:** toggles between masked and plain text.

### A7. Demo quick-fill buttons (positive)
1. Click "Compliance Admin" / "Security Team" quick-fill.
2. **Expected:** email + password fields populate; error cleared.

### A8. Forgot password (positive)
1. `/login` → "Forgot password?" → `/forgot-password`.
2. Enter `compliance@suraksha.local` → **Send reset link**.
3. **Expected:** green success message; "Back to sign in" returns to `/login`.

### A9. Reset password page guard (negative)
1. Open `/reset-password` directly without a recovery token.
2. **Expected:** page renders form but update fails / instructs to use email link (no crash).

### A10. Logout (positive)
1. Logged in, click the logout (→) icon top-right.
2. **Expected:** redirect to `/login`; revisiting `/dashboard` re-checks session and redirects to `/login`.

### A11. Session persists on reload (positive)
1. Logged in, reload the page.
2. **Expected:** stays authenticated (no bounce to `/login`).

---

## Part B — Authorization (RBAC / ABAC / RLS)

### B1. Unauthenticated API = 401 (negative, all data endpoints)
For each endpoint in 0.3 (no `Authorization` header):
- **Expected:** `401`.

### B2. Per-role API permission matrix (positive + negative)
For each role token, call each endpoint/method and assert the status implied by 0.2/0.3. Representative assertions:

| Case | Role | Call | Expected |
|------|------|------|----------|
| B2-a | compliance_admin | GET /api/documents | 200 |
| B2-b | compliance_admin | POST /api/obligations (valid) | 201 |
| B2-c | compliance_admin | GET /api/integrations/security-findings | **403** |
| B2-d | security_team | GET /api/integrations/security-findings | 200 |
| B2-e | security_team | POST /api/obligations | 201 |
| B2-f | security_team | DELETE /api/documents?id=x | **403** (no documents.delete) |
| B2-g | executive_viewer | GET /api/documents | 200 |
| B2-h | executive_viewer | POST /api/upload-document | **403** |
| B2-i | executive_viewer | POST /api/obligations | **403** |
| B2-j | internal_auditor | GET /api/obligations | 200 |
| B2-k | internal_auditor | POST /api/obligations | **403** |
| B2-l | department_owner | GET /api/obligations | 200 (dept-scoped) |
| B2-m | department_owner | POST /api/obligations | **403** |
| B2-n | department_owner | POST /api/evidence (own dept obl) | 201 |
| B2-o | org_admin | GET /api/documents | 200 (full oversight after migration 010) |
| B2-p | org_admin | PATCH /api/settings | 200 |
| B2-q | compliance_admin | PATCH /api/settings | **403** (no settings.manage) |
| B2-r | compliance_admin | POST /api/notifications | **403** |
| B2-s | org_admin | POST /api/notifications (valid) | 201 |

### B3. Department ABAC isolation (negative)
1. As `department_owner` (Operations), GET `/api/obligations`.
2. **Expected:** every returned row has no department or `department === "Operations"`; never another department's rows.

### B4. IDOR protection (negative)
As compliance_admin, with random UUIDs that don't belong to the org:
- POST `/api/map-cards` with fake `obligation_id` → **403**.
- POST `/api/impact` with fake `document_id` → **403**.
- POST `/api/drift` with fake `base_doc_id`/`new_doc_id` → **403**.
- GET `/api/documents/<fakeUUID>/download` → **404**.

### B5. Input validation (negative)
- POST `/api/obligations` missing `title` → **400**.
- POST `/api/map-cards` missing `obligation_id` → **400**.
- POST `/api/evidence` missing `title` → **400**.
- PUT `/api/evidence` missing `?id=` → **400**.
- POST `/api/drift` missing ids → **400**.
- POST `/api/impact` missing `document_id` → **400**.
- POST `/api/obligations` with malformed JSON body → **400**.

### B6. UI route guard (negative)
- As executive_viewer, open `/settings`, `/upload`, `/obligations`, `/security-findings` directly.
- **Expected:** "Access denied" screen for each (these are excluded for executive in 0.4).

### B7. Token tampering (negative)
1. Send `Authorization: Bearer not-a-real-token` to `/api/me`.
2. **Expected:** `401`.

---

## Part C — Dashboards (all 6)

For **every** dashboard: verify (i) it loads without page/console crash, (ii) the app shell (sidebar + top nav) renders, (iii) KPI tiles render real numbers, (iv) charts/sections populate or show a proper empty state, (v) no `KPICard` "Element type is invalid" error.

### C1. Generic Dashboard (`/dashboard`) — org_admin
1. Login as `admin@`.
2. **Expected:** generic dashboard renders. Because org_admin lacks `documents.read`, KPIs may be `0` and console may show `403` (expected). No UI crash.
3. **Expected:** role-based auto-redirect does **not** apply to org_admin (stays on `/dashboard`).

### C2. Auto-redirect by persona (positive)
1. Login as compliance_admin → land `/dashboard/compliance`.
2. Repeat for security/audit/executive/team (table 0.1).

### C3. Executive Dashboard (`/dashboard/executive`)
1. Login as `executive@`.
2. **Expected:** 4 KPI tiles with real values; **Compliance Trend** area chart; **Active Escalations** list (items or "No active escalations"); **Highest-Risk Departments** cards.
3. **Negative:** no `KPICard undefined` error (icon map must include Scale, ShieldCheck, GitBranch, FileText).

### C4. Compliance Operations Dashboard (`/dashboard/compliance`)
1. Login as `compliance@`.
2. **Expected:** 4 KPI tiles; **Recent Compliance Activity** feed (from audit trail) or "No recent activity"; **Department Risk Overview** progress bars with live scores and trend badges.

### C5. Security & IT Dashboard (`/dashboard/security`)
1. Login as `security@`.
2. **Expected:** KPI tiles incl. **Open Findings** + **IT Readiness**; **Security Findings** table (rows or "No security findings"); counts header "(N total · M open)".
3. **Negative:** findings fetch uses `security.findings.read`; with no findings, shows clean empty state (not error).

### C6. Internal Audit Dashboard (`/dashboard/audit`)
1. Login as `audit@`.
2. **Expected:** 4 KPI tiles; optional red "Departments Below 60% Readiness" banner; **Audit Trail (last 20)** list with severity icons; **Export Audit Trail** button.
3. **Positive:** click **Export Audit Trail** → CSV downloads.
4. **Negative:** no `KPICard undefined` error; empty trail shows "No audit entries yet."

### C7. Department Owner Dashboard (`/dashboard/team`)
1. Login as `owner@`.
2. **Expected:** 3 tiles (Assigned Tasks, Due This Week, Overdue); obligation list filtered to owner's department (or empty).
3. **Negative:** no cross-department obligations shown.

### C8. Cross-dashboard KPI consistency (interrelation)
1. As compliance_admin note **Compliance Score** on `/dashboard/compliance`.
2. Open `/analytics` and `/reports`.
3. **Expected:** the same compliance score / obligation totals appear (same source data).

---

## Part D — Document lifecycle

### D1. Upload page renders (positive) — compliance_admin
1. `/upload`.
2. **Expected:** drop zone + intake UI; recent uploads area.

### D2. Upload valid PDF (positive)
1. Drag/drop or pick a compliance PDF.
2. **Expected:** queue item; status uploading → processing → "queued for AI extraction"; success toast.
3. **Expected (DB):** new row in `documents`; appears in `/documents`.

### D3. Upload unsupported file (negative)
1. Pick a `.txt` (or non-PDF).
2. **Expected:** "not supported / unsupported / failed" feedback; no document row created.

### D4. Upload API guard (negative)
- POST `/api/upload-document` with empty/again non-multipart body → **400**.
- As executive_viewer → **403**.

### D5. Documents list (positive)
1. `/documents`.
2. **Expected:** list with name/size/status/obligation count; **Refresh** button works.

### D6. Document details + download (positive)
1. Click a document → right panel details.
2. Click **Download Original** → **Expected:** file downloads via 5-min signed URL.
3. **View Obligations** → navigates to `/obligations`.

### D7. Download negative
- GET `/api/documents/<fakeUUID>/download` → **404**.

### D8. Delete document (positive + negative)
1. As compliance_admin delete a document → toast + removed.
2. As security_team call DELETE `/api/documents?id=x` → **403**.

---

## Part E — Obligations

### E1. List + filters (positive)
1. `/obligations` as compliance_admin.
2. **Expected:** table (Title, Regulation, Department, Status, Priority, Confidence); status + priority filters work.

### E2. Create obligation (positive)
1. **+ New Obligation**, fill required fields, create.
2. **Expected:** 201; toast; row appears; audit entry `obligation_created`.

### E3. Create missing fields (negative)
- POST `/api/obligations` without title/department → **400**.

### E4. Edit obligation (positive)
1. Edit a row → set status `Compliant` → save.
2. **Expected:** PUT 200; row updates.

### E5. Edit/delete permission (negative)
- As compliance_analyst (or any role without `obligations.assign`) PUT/DELETE `/api/obligations/[id]` → **403**.
- PUT/DELETE unknown id (admin) → **404**.

### E6. Delete obligation (positive)
1. Delete the test obligation from E2.
2. **Expected:** confirm → removed.

### E7. Department isolation (negative)
- As department_owner, list shows only own-department obligations (see B3).

---

## Part F — MAP Board

### F1. Board renders (positive)
1. `/map-board` as compliance_admin.
2. **Expected:** columns Backlog / In Progress / Review / Completed; cards placed by status.

### F2. Create card (positive)
1. **+ New MAP Card**, link to a real obligation_id, set owner/due/priority, create.
2. **Expected:** 201; card in Backlog; audit entry.

### F3. Create card negatives
- POST `/api/map-cards` missing title → **400**; missing obligation_id → **400**; **foreign** obligation_id → **403** (IDOR).

### F4. Drag & drop persists (positive)
1. Drag card Backlog → In Progress; reload.
2. **Expected:** stays in In Progress (PUT persisted).

### F5. Edit/delete card (positive + negative)
1. Edit priority → save; delete card.
2. **Expected:** PUT/DELETE 200.
- Unknown id → **404**; role without `obligations.assign` → **403**.

---

## Part G — Evidence Intelligence

### G1. View grouped evidence (positive)
1. `/evidence` as compliance_admin.
2. **Expected:** evidence grouped by obligation; completion progress; department + status filters.

### G2. Add evidence (positive)
1. Add evidence to an obligation.
2. **Expected:** POST 201; item appears; obligation evidence_count increments; audit entry.

### G3. Add evidence negatives
- Missing fields → **400**; foreign obligation_id → **403**.

### G4. Toggle collected (positive)
1. Check / uncheck an evidence item.
2. **Expected:** PUT 200; collected state toggles; approval_status reflects approver permission.

### G5. AI recommendations (positive)
1. **Get AI Recommendations** on an obligation group.
2. **Expected:** loading → new recommended evidence items added; toast "Added N…".

### G6. Evidence read scoping (negative)
- GET `/api/evidence?obligation_id=<foreign>` → **403**.

---

## Part H — Knowledge Graph

### H1. Graph renders (positive)
1. `/knowledge-graph` as compliance_admin.
2. **Expected:** nodes for Documents/Obligations/Departments/MAP Actions/Evidence; color-coded; zoom + drag.

### H2. Filter by node type (positive)
1. Toggle node-type filter buttons.
2. **Expected:** node sets toggle; counts update.

### H3. Access (negative)
- As security_team/executive (excluded) open `/knowledge-graph` → "Access denied".

---

## Part I — Drift Analyzer

### I1. Requires 2 documents (positive)
1. `/drift` as compliance_admin; pick Base + New circular; **Run Drift Analysis**.
2. **Expected:** drift score ring; summary; changes list (New/Removed/Modified).

### I2. Filter results (positive)
1. Toggle New / Removed / Changed; expand a change.
2. **Expected:** list filters; details expand.

### I3. Drift negatives
- POST `/api/drift` missing ids → **400**; foreign doc ids → **403**.
- Access by excluded role (e.g., executive) → "Access denied".

---

## Part J — Readiness Scoring

### J1. View readiness (positive)
1. `/readiness` (visible to all).
2. **Expected:** overall score ring; department cards w/ status + recommendations; radar + bar charts.

### J2. Live recompute (interrelation)
1. Note Compliance dept score; set some obligations Compliant; revisit `/readiness`.
2. **Expected:** score updates on mount.

---

## Part K — Impact Simulation

### K1. Run simulation (positive)
1. `/impact` as compliance_admin; pick a processed document; **Run Simulation**.
2. **Expected:** summary (risk level, eng hours, weeks, departments); Impacted Teams table; risk indicators.

### K2. Past simulations (positive)
1. Scroll below form.
2. **Expected:** previous runs listed.

### K3. Impact negatives
- POST `/api/impact` missing document_id → **400**; foreign doc → **403**.

---

## Part L — Audit Trail (page)

### L1. View trail (positive) — compliance_admin / internal_auditor
1. `/audit`.
2. **Expected:** timeline of actions; actor/action/target/timestamp; color-coded.

### L2. Filter (positive)
1. Open **Filter**; type actor email; choose action.
2. **Expected:** timeline filters; active-filter dot; **Clear** resets.

### L3. Export (positive)
1. **Export Logs** → CSV downloads.

### L4. Realtime append (interrelation)
1. Open `/audit`; in another tab create an obligation.
2. **Expected:** new entry appears at top without manual refresh.

### L5. Access (negative)
- As security_team/executive/department_owner open `/audit` → "Access denied".

---

## Part M — Analytics

### M1. View analytics (positive)
1. `/analytics` as compliance_admin.
2. **Expected:** KPI cards; risk heatmap; compliance trend line; department risk breakdown.

### M2. Live-data consistency (interrelation)
- Compliance Score matches Dashboard (see C8).

### M3. Access (negative)
- As security_team/department_owner open `/analytics` → "Access denied".

---

## Part N — Reports

### N1. View report (positive) — compliance_admin / executive_viewer
1. `/reports`.
2. **Expected:** executive summary; compliance posture pie; document statistics; department breakdown.

### N2. Export CSV (positive)
1. **Export CSV** → file downloads.

### N3. Print (positive)
1. **Print Report** → browser print dialog.

---

## Part O — Security Findings

### O1. View page (positive) — security_team
1. `/security-findings`.
2. **Expected:** severity tiles (Critical/High/Medium/Low/Info); status filter default "open"; findings list or empty state.

### O2. Import findings (positive)
- POST `/api/integrations/security-findings` as security_team with a `findings[]` payload → **201**; appears in list + Security dashboard.

### O3. Filter (positive)
1. Click **High** tile; change Source to `trivy`.
2. **Expected:** list filters; tile highlighted.

### O4. Access (negative)
- As compliance_admin: not in sidebar; direct `/security-findings` → "Access denied"; GET `/api/integrations/security-findings` → **403**.

---

## Part P — Notifications

### P1. View panel (positive)
1. Click **bell**.
2. **Expected:** panel opens with list; unread badge on bell.

### P2. Mark read (positive)
1. **Mark all read** / click a notification.
2. **Expected:** PATCH 200; badge clears.

### P3. Create permission (negative + positive)
- POST `/api/notifications` as compliance_admin → **403**.
- POST `/api/notifications` as org_admin with `{title,message,type}` → **201**; missing fields → **400**.

### P4. Realtime badge (interrelation)
1. Open panel; POST a notification (org_admin token).
2. **Expected:** bell badge updates within ~2s (Supabase realtime).

---

## Part Q — Settings

### Q1. View settings (positive) — compliance_admin / org_admin
1. `/settings`.
2. **Expected:** sections: Organization, Notifications, Compliance Thresholds, AI Extraction, Appearance.

### Q2. Save settings (positive + negative)
- As org_admin: change a field → **Save** → toast success → persists after re-login (PATCH 200).
- As compliance_admin: **Save** → **403** (no settings.manage); surfaced as error toast.

### Q3. Access (negative)
- As executive_viewer open `/settings` → "Access denied".

---

## Part R — AI Pipeline / Extraction

### R1. Pipeline status (positive)
- GET `/api/ai-pipeline` as compliance_admin → 200; returns `capabilities` + `review_queue` array.

### R2. Extraction listing (positive)
- GET `/api/extract-obligations` as compliance_admin → 200.

### R3. Extraction guard (negative)
- POST `/api/extract-obligations` with non-multipart body → **400**.
- As executive_viewer (no obligations.create) POST → **403**.

---

## Part S — Realtime matrix

| Feature | Realtime | Verify |
|---------|:-------:|--------|
| Dashboard KPIs | ✅ | create obligation in Tab 2 → KPIs change in Tab 1 |
| Obligations list | ✅ | add obligation in Tab 2 |
| MAP Board | ✅ | move card in Tab 2 |
| Audit Trail | ✅ | any mutation in Tab 2 → new top entry |
| Notifications bell | ✅ | POST notification → badge update |
| Documents list | ❌ (manual Refresh) | click Refresh |
| Readiness | ❌ (on mount) | reload |

---

## Part T — Error / empty states

### T1. Empty data (positive handling)
- As department_owner with no assignments: `/obligations` empty state, `/map-board` empty columns, `/dashboard/team` zeros.

### T2. App error surfaces (negative handling)
- Force an API error (e.g., disconnect) on `/knowledge-graph` → error toast / ErrorState, **not** a blank page or unhandled crash.

### T3. 404 route
- Open `/this-route-does-not-exist` → Next.js not-found page (no shell crash).

---

## Part U — Full compliance workflow (one pass, compliance_admin)

1. **Upload** an RBI circular → wait "Queued for AI extraction".
2. **Obligations** → AI-extracted obligations appear (citations/confidence/department) [requires Ollama].
3. **MAP Board** → create a card linked to an obligation.
4. **Evidence** → Get AI Recommendations; mark one collected.
5. **Impact** → select the document; run; note risk + impacted teams.
6. **Drift** → with 2 docs, run; note score + changes.
7. **Readiness** → department scores reflect evidence.
8. **Reports** → review posture; **Export CSV**.
9. **Audit Trail** → verify upload/obligation/evidence entries; **Export**.
10. **Switch persona** (incognito) → Executive sees Reports/Analytics, no upload/create.

---

## Appendix — Automated coverage map

`scripts/e2e-complete-suite.cjs` mirrors this document:

| Doc part | Automated? | How |
|----------|:---------:|-----|
| A Auth | ✅ | UI login per role + redirect/invalid/logout |
| B Authz (RBAC/ABAC/IDOR/validation) | ✅ | API matrix with per-role tokens |
| C Dashboards | ✅ | Browser visit per role + KPI/shell/error checks + screenshots |
| D Documents | ⚠️ partial | API guards + list/page render; real upload needs a PDF/Ollama |
| E Obligations | ✅ | CRUD + negatives via API; page render |
| F MAP Board | ✅ | CRUD + IDOR via API; board render |
| G Evidence | ✅ | CRUD + negatives via API; page render |
| H Knowledge Graph | ✅ | render + access guard |
| I Drift | ✅ | negatives via API; render |
| J Readiness | ✅ | render + API |
| K Impact | ✅ | negatives via API; render |
| L Audit | ✅ | render + export button + access guard |
| M Analytics | ✅ | render + access guard |
| N Reports | ✅ | render + export |
| O Security findings | ✅ | import + read + access guard |
| P Notifications | ✅ | GET/PATCH/POST perms |
| Q Settings | ✅ | GET + PATCH perms |
| R AI pipeline | ✅ | GET endpoints + POST guards |
| S Realtime | ⚠️ partial | best-effort (notification POST then poll) |
| T Error states | ✅ | 404 + access denied captured |
| U Full workflow | ⚠️ partial | API-driven create→evidence→map→drift/impact→cleanup |

Artifacts: `test-results/complete-suite/report.json`, `SUMMARY.md`, `screenshots/<role>/*.png`.

*Complete E2E Test Plan — generated for Suraksha OS.*
