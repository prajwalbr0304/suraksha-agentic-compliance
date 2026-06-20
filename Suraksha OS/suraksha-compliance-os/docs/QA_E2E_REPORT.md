# Suraksha Compliance OS — End-to-End QA Report

- **Tenant:** `test-cooperative-bank`
- **User:** `manager@testbank.com` (role: bank manager; org id `e6ef4039-…`)
- **App:** `http://localhost:3000` (Next.js 16.2.4, Turbopack) — run in terminal 2 (`npm run dev`)
- **Agent service:** `http://localhost:8088` (FastAPI + Ollama `llama3.1:latest`, scheduler ON) — run in terminal 1 (`uvicorn app.main:app`)
- **Date:** 2026-06-12
- **Method:** Headless Chromium via Playwright. Console + network captured per page; screenshots in `test-results/qa-screens/`; raw data in `test-results/qa-results.json`, `qa-interactions.json`.
- **Non-destructive:** delete actions were only exercised against bogus IDs to confirm guards; no real tenant data was deleted. The Ollama obligation-extraction (~10 min/PDF) was **triggered but not awaited** — the agent returns `202 Accepted` and works async, which is the correct design.

---

## 0. CRITICAL environment finding (resolved during testing)

The **first** full pass failed every protected page: login succeeded and the Supabase session persisted in `localStorage`, but **every `/api/*` route and every `/dashboard/[orgSlug]/*` page returned HTTP 404**, while `/login` and bare `/dashboard` returned 200. With no principal bootstrap (`/api/me` 404), the client auth guard bounced all pages to `/login`.

- **Root cause:** a **corrupt / incomplete Turbopack dev build** in `.next` (dev log showed repeated *"Slow filesystem detected"* + *"filesystem cache database compaction"*). `proxy.ts` (Next 16's middleware) and all route handlers are correct; the route manifest was simply not fully emitted.
- **Fix applied (environment only, no code change):** stopped dev server → deleted `.next` → restarted `npm run dev`. After the clean rebuild, a direct token-authenticated probe of 8 API routes returned **200 with real data**, and the full browser pass then passed cleanly.
- **Action for the team:** if pages/APIs 404 wholesale in dev, clear `.next` and restart. The repeated "slow filesystem" warning suggests the project path (`Desktop\Suraksha OS`, with a space) on a slow/synced disk is aggravating Turbopack cache corruption — consider moving the repo to a local non-synced path.

All results below are from the **clean** run.

---

## 1. Summary table (21 routes)

| # | Page | Status | Critical Issues | Console Errors | Network Errors |
|---|------|--------|-----------------|:--------------:|:--------------:|
| 1 | Dashboard (`compliance`) | ✅ Pass | none | 0 | 0 |
| 2 | Upload (`upload`) | ✅ Pass | none | 0 | 0 |
| 3 | Documents (`documents`) | ✅ Pass | none | 0 | 0 |
| 4 | Regulation Center (`regulation-center`) | ✅ Pass | none | 0 | 0 |
| 5 | Obligations (`obligations`) | ✅ Pass | none | 0 | 0 |
| 6 | Compliance Action Board (`map-board`) | ✅ Pass | none | 0 | 0 |
| 7 | My Tasks (`my-tasks`) | 🟡 Partial | empty-state only (no tasks) | 0 | 0 |
| 8 | Knowledge Graph (`knowledge-graph`) | 🟡 Partial | React Flow container 0×0 warning | 0 (3 warn) | 0 |
| 9 | Regulatory Change Analysis (`drift`) | ✅ Pass | none | 0 | 0 |
| 10 | Readiness (`readiness`) | 🟡 Partial | Recharts container -1×-1 warning | 0 (4 warn) | 0 |
| 11 | Evidence (`evidence`) | ✅ Pass | none | 0 | 0 |
| 12 | Compliance Impact Analysis (`impact`) | ✅ Pass | none | 0 | 0 |
| 13 | Security Findings (`security-findings`) | ✅ Pass | none | 0 | 0 |
| 14 | Reports (`reports`) | ✅ Pass | none | 0 | 0 |
| 15 | Audit Trail (`audit`) | ✅ Pass | none | 0 | 0 |
| 16 | Agents (`agents`) | ✅ Pass | none | 0 | 0 |
| 17 | Users — Admin (`admin/users`) | ✅ Pass | self-row role select disabled (correct) | 0 | 0 |
| 18 | Departments — Admin (`admin/departments`) | ✅ Pass | none | 0 | 0 |
| 19 | Teams — Admin (`admin/teams`) | ✅ Pass | none | 0 | 0 |
| 20 | Access Control — Admin (`admin/access`) | ✅ Pass | none | 0 | 0 |
| 21 | Settings (`settings`) | ✅ Pass | none | 0 (1 warn) | 0 |

**Totals:** 17 clean Pass, 4 Partial (cosmetic/empty-state only), 0 Fail. **Console errors across all pages: 0. Network errors across all pages: 0.** Refresh kept auth on **every** page.

> Note on `activeNav: "Dashboard"`: the harness heuristic for the active sidebar item matched the first link on every page, so this field is unreliable and was not used to judge nav highlighting. Screenshots show correct active highlighting.

---

## 2. Detail sections (non-clean pages)

### 7. My Tasks — 🟡 Partial — Severity: Low (data, not defect)
- Page renders (`bodyLen 636`, 5 buttons), 0 console/network errors, refresh OK.
- Shows an **empty state** — this manager currently has no tasks assigned. Genuine empty state, not a bug. Re-test after assigning a task / running the pipeline.

### 8. Knowledge Graph — 🟡 Partial — Severity: Low (cosmetic)
- Screen: `int-…`/`08-knowledge-graph.png`. Body renders rich content (`bodyLen 8389`, 18 buttons), 0 errors.
- **Warning (×3):** `[React Flow]: The React Flow parent container needs a width and a height to render the graph (error#004).` The graph canvas's parent has no resolved height at first paint (likely a flex/height-0 race). Graph may appear blank until a resize/interaction.
- **Fix:** give the React Flow wrapper an explicit height (e.g. `h-[600px]` or `flex-1 min-h-0`).

### 10. Readiness — 🟡 Partial — Severity: Low (cosmetic)
- Screen: `10-readiness.png`. Renders (`bodyLen 1001`), 0 errors.
- **Warning (×4):** Recharts `The width(-1) and height(-1) of chart should be greater than 0…` — the `ResponsiveContainer` parent resolves to a negative/zero size at first paint, so the gauge/chart may not draw until resize.
- **Fix:** ensure the chart's parent has a defined height (`min-h-[…]` / explicit height on the `ResponsiveContainer` wrapper).

### 21. Settings — ✅ Pass (1 warning) — Severity: Cosmetic
- One **Supabase Realtime WebSocket** connection log (informational; connection succeeds). Not an error.

### 17. Users (Admin) — ✅ Pass (expected control)
- The first `<select>` is `disabled` with title *"You cannot change…"* (the logged-in manager can't change their own role) — correct guardrail, not a defect. Other role selects (9 options) work.

---

## 3. Cross-cutting checks (Step 4)

| Check | Result | Evidence |
|-------|--------|----------|
| **Logout** clears session & redirects to `/login` | ✅ Pass | `[logout] redirected to /login` |
| **Auth guard** — protected URL while logged out → login | ✅ Pass | `[auth-guard] protected route blocked when logged out`; `/api/me` correctly returns **401** (not 404) once cache is healthy |
| **Invalid route** → proper not-found page | ✅ Pass | `[404] proper not-found page shown` (`x2-404.png`) |
| **Sidebar present / rail+panel** | ✅ Pass | `[sidebar] present=1`; tab/category switching verified in interaction probe |
| **Responsive @768px** — no horizontal overflow | ✅ Pass | `[responsive-768] no horizontal overflow` (`x1-responsive-768.png`) |

---

## 4. Interaction probe (custom components) — all ✅, 0 errors

Because the app uses custom (non-native) tab/select components, a second focused probe drove real elements (`test-results/qa-interactions.json`):

- **Regulation Center** (the rebuilt page): all 4 main tabs switch (**Regulation Sources, Extracted Regulations, Monitor, Logs**); **Edit-source dialog opens and closes via Escape**; all 4 Extracted sub-pills work (**approved, rejected, completed, failed**). 0 errors.
- **Settings:** Notifications / Security tabs switch. 0 errors.
- **Documents / Obligations / Agents:** load with real data, 0 errors. (`Add Obligation`, `New MAP`, `New User`, `New Department`, `New Team` open inline forms/side-panels rather than `role=dialog`, so the generic probe logged "no dialog detected" — not a failure.)

### Backend wiring for the new Regulation Center features (verified, non-blocking)
| Endpoint / action | Result |
|---|---|
| `GET /api/regulation-center/logs` | **200**, returns log lines |
| `GET /api/regulatory-sources` | **200**, 7 configured sources |
| `POST /api/agents/runs {pipeline:"watch", source_id}` (per-source download/monitor) | **202 Accepted**, `run_id` returned; agent-service logged `POST /runs 202` and began async scan |
| `DELETE /api/regulation-center?id=<bogus>` | **404** "Change not found" (guard OK, no crash) |
| `DELETE /api/regulatory-sources?id=<bogus>` | **404** "Source not found" (guard OK, no crash) |
| Agent `/health` | **200** `{status:ok, llm_backend:local_litellm, model:ollama_chat/llama3.1:latest, scheduler:true}` |

> The Ollama extraction (~10 min/PDF) was intentionally **not awaited**; the 202 + async design means the UI never blocks on it, which is correct.

---

## 5. Top issues to fix first

1. **[High — DX/Infra] Turbopack dev cache corruption → wholesale 404s.** All routes 404'd until `.next` was cleared. Document a "clear `.next` and restart" step; investigate moving the repo off the spaced/synced `Desktop\Suraksha OS` path (repeated "slow filesystem" warnings). This is the only issue that actually blocked functionality.
2. **[Low — Cosmetic] Knowledge Graph** React Flow container has no height at first paint (error#004 ×3). Give the canvas wrapper an explicit height / `flex-1 min-h-0`.
3. **[Low — Cosmetic] Readiness** Recharts `ResponsiveContainer` resolves to negative size at first paint (×4 warnings). Set a `min-h` on the chart wrapper.
4. **[Low — Hydration] Login page** emitted a one-time React hydration-mismatch warning (a `caret-color` style diff from a browser/extension or animation). Cosmetic; worth confirming the login form isn't rendering client-only style on the server.
5. **[Info — Data] My Tasks** empty for this manager — re-test with assigned tasks to validate the populated state and complete/in-progress actions.
6. **[Info] Settings** opens an inline Realtime WebSocket (expected); `New *` admin actions use inline panels rather than ARIA dialogs — consider `role="dialog"` for accessibility and easier automation.

---

## 6. What was confirmed working (highlights)

- Login → tenant dashboard redirect; **session persists across hard navigation and reload on all 21 pages**.
- All 21 routes render **real data with zero console and zero network errors** after the clean build.
- Dashboard (stat cards/widgets), Documents (46 actions), Compliance Action Board (board + filters), Drift & Impact (23-option regulation selectors), Security Findings (severity/status filters + search), Audit Trail, Agents (18 KB of live content) all populate.
- **Regulation Center rebuild** (tabs, edit modal, Extracted sub-pills, per-source download via `source_id`, logs endpoint, delete guards) is fully functional end-to-end against the live agent-service.
- Cross-cutting: logout, auth-guard, 404 page, responsive @768px — all pass.

**Overall verdict:** Once the stale Turbopack cache was cleared, the platform is **healthy end-to-end** — 0 console/network errors across all 21 routes, all cross-cutting checks pass, and the new Regulation Center functionality works against the live Ollama-backed agent service. Remaining items are cosmetic chart-sizing warnings and empty-state data, not defects.
