/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * QA Full Suite — Suraksha OS
 * ----------------------------------------------------------------------------
 * End-to-end QA harness that:
 *   1. (Re)generates + uploads realistic seed data.
 *   2. Executes every business flow through the real HTTP API (auth as each role).
 *   3. Validates DATABASE STATE after each transaction (service-role reads).
 *   4. Drives the browser (Playwright) to screenshot all dashboards + feature pages per role.
 *   5. Logs defects with severity + evidence.
 *   6. Produces a comprehensive QA report (docs/QA_REPORT.md) + JSON + screenshots.
 *
 * Requires: dev server (npm run dev) + .env.local (URL, anon key, service role key, optional DB pw).
 * Usage:    npm run qa
 *
 * Env:
 *   E2E_BASE_URL       default http://localhost:3000
 *   E2E_HEADLESS       default true
 *   QA_SKIP_SEED       "1" to skip re-seeding
 *   QA_SKIP_BROWSER    "1" to skip screenshot pass (API + DB only)
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium, request: pwRequest } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const outDir = path.join(root, "test-results", "qa");
const shotsDir = path.join(outDir, "screenshots");
const headless = process.env.E2E_HEADLESS !== "false";
const skipSeed = process.env.QA_SKIP_SEED === "1";
const skipBrowser = process.env.QA_SKIP_BROWSER === "1";

function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
}
loadEnv();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !ANON || !SERVICE) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON / SERVICE_ROLE_KEY");
  process.exit(1);
}
const db = createClient(SUPA_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const USERS = [
  { email: "admin@suraksha.local", password: "SurakshaAdmin@2026", role: "org_admin", dashboard: "/dashboard" },
  { email: "compliance@suraksha.local", password: "SurakshaCompliance@2026", role: "compliance_admin", dashboard: "/dashboard/compliance" },
  { email: "security@suraksha.local", password: "SurakshaSecurity@2026", role: "security_team", dashboard: "/dashboard/security" },
  { email: "audit@suraksha.local", password: "SurakshaAudit@2026", role: "internal_auditor", dashboard: "/dashboard/audit" },
  { email: "executive@suraksha.local", password: "SurakshaExecutive@2026", role: "executive_viewer", dashboard: "/dashboard/executive" },
  { email: "owner@suraksha.local", password: "SurakshaOwner@2026", role: "department_owner", dashboard: "/dashboard/team" },
];

// Pages to screenshot per role for the QA gallery (only what each role can access).
const ROLE_PAGES = {
  compliance_admin: ["/dashboard/compliance", "/documents", "/obligations", "/map-board", "/evidence", "/knowledge-graph", "/drift", "/readiness", "/impact", "/audit", "/analytics", "/reports", "/settings", "/upload"],
  org_admin: ["/dashboard", "/documents", "/obligations", "/analytics", "/reports", "/settings"],
  security_team: ["/dashboard/security", "/security-findings", "/obligations", "/map-board", "/evidence"],
  internal_auditor: ["/dashboard/audit", "/audit", "/knowledge-graph", "/analytics", "/reports", "/evidence"],
  executive_viewer: ["/dashboard/executive", "/impact", "/analytics", "/reports", "/documents"],
  department_owner: ["/dashboard/team", "/obligations", "/map-board", "/evidence", "/readiness"],
};

// ── reporting state ──────────────────────────────────────────────────────────
const state = {
  startedAt: new Date().toISOString(),
  baseURL,
  project: process.env.SUPABASE_PROJECT_ID || "",
  orgId: null,
  checks: [],      // { area, name, status: pass|fail, expected, actual }
  dbValidations: [], // { tx, table, expectation, status, detail }
  defects: [],     // { id, severity, area, title, expected, actual, evidence }
  screenshots: [], // { role, page, file }
  seed: null,
};
let defectSeq = 0;

function check(area, name, ok, expected, actual) {
  state.checks.push({ area, name, status: ok ? "pass" : "fail", expected: String(expected), actual: String(actual) });
  console.log(`  [${ok ? "PASS" : "FAIL"}] ${area} :: ${name} (exp=${expected} act=${actual})`);
  return ok;
}
function defect(severity, area, title, expected, actual, evidence = "") {
  defectSeq += 1;
  const id = `DEF-${String(defectSeq).padStart(3, "0")}`;
  state.defects.push({ id, severity, area, title, expected: String(expected), actual: String(actual), evidence });
  console.log(`  [DEFECT ${id}|${severity}] ${area}: ${title} (exp=${expected} act=${actual})`);
  return id;
}
/** assert + auto-defect on failure */
function expect(area, name, ok, expected, actual, severity = "High") {
  const passed = check(area, name, ok, expected, actual);
  if (!passed) defect(severity, area, name, expected, actual);
  return passed;
}
function dbVal(tx, table, expectation, ok, detail) {
  state.dbValidations.push({ tx, table, expectation, status: ok ? "pass" : "fail", detail: String(detail) });
  console.log(`    DB[${ok ? "OK" : "BAD"}] ${tx} · ${table} · ${expectation} — ${detail}`);
  if (!ok) defect("High", `DB:${table}`, `${tx} — ${expectation}`, "DB consistent", detail);
  return ok;
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    try { const r = await fetch(baseURL); if (r.ok || r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not reachable at ${baseURL}. Run npm run dev.`);
}
async function signIn(u) {
  const c = createClient(SUPA_URL, ANON);
  const { data, error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error || !data.session?.access_token) throw new Error(`login ${u.email}: ${error?.message}`);
  return { token: data.session.access_token, user: data.user };
}
function apiCtx(token) {
  return pwRequest.newContext({ baseURL, extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {} });
}

// ════════════════════════════════════════════════════════════════════════════
// Business flows with DB validation after each transaction
// ════════════════════════════════════════════════════════════════════════════
async function flowObligationLifecycle(tokens) {
  console.log("\n=== FLOW 1 — Obligation → Evidence → MAP lifecycle (compliance_admin) ===");
  const ctx = await apiCtx(tokens.compliance_admin);
  const ref = `QA-${Date.now()}`;
  let oblId = null, evId = null, mapId = null;

  // 1a create obligation
  const cr = await ctx.post("/api/obligations", { data: { title: `QA Obligation ${ref}`, department: "Compliance", regulation: "QA Reg", priority: "high", status: "in_progress", due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), tags: ["qa"] } });
  expect("Flow1", "POST /api/obligations -> 201", cr.status() === 201, 201, cr.status());
  if (cr.status() === 201) oblId = (await cr.json()).id;

  if (oblId) {
    const { data: row } = await db.from("obligations").select("id, title, department, organization_id, created_by, review_status").eq("id", oblId).maybeSingle();
    dbVal("create obligation", "obligations", "row exists with correct org + dept", !!row && row.department === "Compliance" && row.organization_id === state.orgId, row ? `dept=${row.department} org=${row.organization_id} review=${row.review_status}` : "missing");
    const { data: aud } = await db.from("audit_trail").select("id, action").eq("target_id", oblId).eq("action", "obligation_created");
    dbVal("create obligation", "audit_trail", "obligation_created entry logged", (aud || []).length >= 1, `entries=${(aud || []).length}`);
  }

  // 1b add evidence
  if (oblId) {
    const ev = await ctx.post("/api/evidence", { data: { obligation_id: oblId, title: "QA Evidence" } });
    expect("Flow1", "POST /api/evidence -> 201", ev.status() === 201, 201, ev.status());
    if (ev.status() === 201) evId = (await ev.json()).id;
    const { data: erow } = await db.from("evidence").select("id, organization_id").eq("id", evId || "00000000-0000-0000-0000-000000000000").maybeSingle();
    dbVal("add evidence", "evidence", "evidence row exists in org", !!erow && erow.organization_id === state.orgId, erow ? `org=${erow.organization_id}` : "missing");
    const { data: ob2 } = await db.from("obligations").select("evidence_count").eq("id", oblId).maybeSingle();
    dbVal("add evidence", "obligations", "evidence_count incremented", !!ob2 && ob2.evidence_count >= 1, `evidence_count=${ob2?.evidence_count}`);
  }

  // 1c mark evidence collected
  if (evId) {
    const put = await ctx.put(`/api/evidence?id=${evId}`, { data: { collected: true } });
    expect("Flow1", "PUT /api/evidence (collect) -> 200", put.status() === 200, 200, put.status());
    const { data: erow } = await db.from("evidence").select("collected_at, approval_status").eq("id", evId).maybeSingle();
    dbVal("collect evidence", "evidence", "collected_at set", !!erow && !!erow.collected_at, `collected_at=${erow?.collected_at} approval=${erow?.approval_status}`);
  }

  // 1d create MAP card
  if (oblId) {
    const map = await ctx.post("/api/map-cards", { data: { title: "QA MAP", obligation_id: oblId, owner: "QA", priority: "high" } });
    expect("Flow1", "POST /api/map-cards -> 201", map.status() === 201, 201, map.status());
    if (map.status() === 201) mapId = (await map.json()).id;
    const { data: mrow } = await db.from("map_cards").select("status, organization_id").eq("id", mapId || "00000000-0000-0000-0000-000000000000").maybeSingle();
    dbVal("create map card", "map_cards", "status backlog + org scoped", !!mrow && mrow.status === "backlog" && mrow.organization_id === state.orgId, mrow ? `status=${mrow.status} org=${mrow.organization_id}` : "missing");
  }

  // 1e move MAP card
  if (mapId) {
    const put = await ctx.put(`/api/map-cards/${mapId}`, { data: { status: "in_progress" } });
    expect("Flow1", "PUT /api/map-cards (in_progress) -> 200", put.status() === 200, 200, put.status());
    const { data: mrow } = await db.from("map_cards").select("status").eq("id", mapId).maybeSingle();
    dbVal("move map card", "map_cards", "status -> in_progress", !!mrow && mrow.status === "in_progress", `status=${mrow?.status}`);
    // invalid enum guard
    const bad = await ctx.put(`/api/map-cards/${mapId}`, { data: { status: "in-progress" } });
    expect("Flow1", "PUT invalid status -> 400 (not 500)", bad.status() === 400, 400, bad.status());
  }

  // 1f delete MAP + obligation (cleanup) with DB validation
  if (mapId) {
    const del = await ctx.delete(`/api/map-cards/${mapId}`);
    expect("Flow1", "DELETE /api/map-cards -> 200", del.status() === 200, 200, del.status());
    const { data: mrow } = await db.from("map_cards").select("id").eq("id", mapId).maybeSingle();
    dbVal("delete map card", "map_cards", "row removed", !mrow, mrow ? "still present" : "gone");
  }
  if (oblId) {
    const del = await ctx.delete(`/api/obligations/${oblId}`);
    expect("Flow1", "DELETE /api/obligations -> 200", del.status() === 200, 200, del.status());
    const { data: orow } = await db.from("obligations").select("id").eq("id", oblId).maybeSingle();
    dbVal("delete obligation", "obligations", "row removed", !orow, orow ? "still present" : "gone");
    const { data: erows } = await db.from("evidence").select("id").eq("obligation_id", oblId);
    dbVal("delete obligation", "evidence", "child evidence cascade-deleted", (erows || []).length === 0, `remaining=${(erows || []).length}`);
  }
  await ctx.dispose();
}

async function flowImpactDrift(tokens) {
  console.log("\n=== FLOW 2 — Impact + Drift on seeded documents (compliance_admin) ===");
  const ctx = await apiCtx(tokens.compliance_admin);
  const { data: docs } = await db.from("documents").select("id, regulation_name, storage_path").eq("organization_id", state.orgId).like("storage_path", "seed/%").order("uploaded_at", { ascending: true });
  const list = docs || [];
  if (list.length >= 1) {
    const imp = await ctx.post("/api/impact", { data: { document_id: list[0].id } });
    expect("Flow2", "POST /api/impact -> 200", imp.status() === 200, 200, imp.status());
    if (imp.status() === 200) {
      const body = await imp.json();
      check("Flow2", "impact result has risk_level", !!body.risk_level || !!body.summary, "risk fields", JSON.stringify(Object.keys(body)).slice(0, 80));
    }
  } else {
    defect("Medium", "Flow2", "No seeded documents for impact", ">=1 doc", "0");
  }
  // drift needs the two KYC versions (same regulation)
  const kyc = list.filter((d) => d.regulation_name === "RBI Master Direction - KYC");
  if (kyc.length >= 2) {
    const dr = await ctx.post("/api/drift", { data: { base_doc_id: kyc[0].id, new_doc_id: kyc[1].id } });
    expect("Flow2", "POST /api/drift -> 200", dr.status() === 200, 200, dr.status());
    if (dr.status() === 200) {
      const body = await dr.json();
      check("Flow2", "drift result returned", typeof body === "object" && body !== null, "object", typeof body);
    }
  } else {
    defect("Low", "Flow2", "Fewer than 2 KYC docs for drift", ">=2", String(kyc.length));
  }
  await ctx.dispose();
}

async function flowSecurityFindings(tokens) {
  console.log("\n=== FLOW 3 — Security findings import (security_team) ===");
  const ctx = await apiCtx(tokens.security_team);
  const ext = `qa-${Date.now()}`;
  const res = await ctx.post("/api/integrations/security-findings", { data: { findings: [{ source: "semgrep", external_id: ext, title: "QA Finding", severity: "high", asset: "qa-svc", raw_payload: { qa: true } }] } });
  expect("Flow3", "POST security-findings -> 201", res.status() === 201, 201, res.status());
  const { data: row } = await db.from("integration_findings").select("id, organization_id, severity").eq("external_id", ext).maybeSingle();
  dbVal("import finding", "integration_findings", "row upserted in org", !!row && row.organization_id === state.orgId, row ? `org=${row.organization_id} sev=${row.severity}` : "missing");
  // negative: compliance cannot read
  const cctx = await apiCtx(tokens.compliance_admin);
  const forbidden = await cctx.get("/api/integrations/security-findings");
  expect("Flow3", "compliance read findings -> 403", forbidden.status() === 403, 403, forbidden.status());
  await cctx.dispose();
  if (row) await db.from("integration_findings").delete().eq("id", row.id);
  await ctx.dispose();
}

async function flowNotifications(tokens) {
  console.log("\n=== FLOW 4 — Notifications (org_admin create + mark read) ===");
  const ctx = await apiCtx(tokens.org_admin);
  const title = `QA Notif ${Date.now()}`;
  const res = await ctx.post("/api/notifications", { data: { title, message: "qa", type: "info" } });
  expect("Flow4", "POST notification -> 201", res.status() === 201, 201, res.status());
  const { data: row } = await db.from("notifications").select("id, read, organization_id").eq("title", title).maybeSingle();
  dbVal("create notification", "notifications", "row created unread in org", !!row && row.read === false && row.organization_id === state.orgId, row ? `read=${row.read} org=${row.organization_id}` : "missing");
  // negative: compliance cannot create
  const cctx = await apiCtx(tokens.compliance_admin);
  const forbidden = await cctx.post("/api/notifications", { data: { title: "x", message: "y", type: "info" } });
  expect("Flow4", "compliance create notification -> 403", forbidden.status() === 403, 403, forbidden.status());
  await cctx.dispose();
  if (row) await db.from("notifications").delete().eq("id", row.id);
  await ctx.dispose();
}

async function flowSettings(tokens) {
  console.log("\n=== FLOW 5 — Settings (org_admin save, compliance blocked) ===");
  const ctx = await apiCtx(tokens.org_admin);
  const marker = `qa-${Date.now()}`;
  const res = await ctx.patch("/api/settings", { data: { settings: { qa_marker: marker } } });
  expect("Flow5", "org_admin PATCH settings -> 200", res.status() === 200, 200, res.status());
  const { data: org } = await db.from("organizations").select("settings").eq("id", state.orgId).maybeSingle();
  dbVal("save settings", "organizations", "settings.qa_marker persisted", !!org && org.settings && org.settings.qa_marker === marker, `marker=${org?.settings?.qa_marker}`);
  // negative: compliance blocked + DB unchanged
  const cctx = await apiCtx(tokens.compliance_admin);
  const forbidden = await cctx.patch("/api/settings", { data: { settings: { qa_marker: "HACK" } } });
  expect("Flow5", "compliance PATCH settings -> 403", forbidden.status() === 403, 403, forbidden.status());
  const { data: org2 } = await db.from("organizations").select("settings").eq("id", state.orgId).maybeSingle();
  dbVal("settings tamper", "organizations", "compliance write did NOT change settings", org2?.settings?.qa_marker === marker, `marker=${org2?.settings?.qa_marker}`);
  await cctx.dispose();
  await ctx.dispose();
}

async function flowReadiness(tokens) {
  console.log("\n=== FLOW 6 — Readiness recompute (compliance_admin) ===");
  const ctx = await apiCtx(tokens.compliance_admin);
  const res = await ctx.get("/api/readiness");
  expect("Flow6", "GET /api/readiness -> 200", res.status() === 200, 200, res.status());
  const body = res.status() === 200 ? await res.json() : [];
  check("Flow6", "readiness returns department scores", Array.isArray(body) && body.length >= 1, ">=1 dept", Array.isArray(body) ? body.length : "n/a");
  const { data: rows } = await db.from("readiness_scores").select("id").eq("organization_id", state.orgId);
  dbVal("readiness", "readiness_scores", "scores persisted for org", (rows || []).length >= 1, `rows=${(rows || []).length}`);
  await ctx.dispose();
}

async function flowAbacIdorValidation(tokens) {
  console.log("\n=== FLOW 7 — ABAC + IDOR + validation (negative, with DB integrity) ===");
  const owner = await apiCtx(tokens.department_owner);
  const ores = await owner.get("/api/obligations");
  if (ores.status() === 200) {
    const rows = await ores.json();
    const ok = Array.isArray(rows) && rows.every((r) => !r.department || String(r.department).toLowerCase() === "operations");
    expect("Flow7", "department_owner only sees Operations", ok, "only Operations", `rows=${rows.length}`);
  } else expect("Flow7", "department_owner obligations -> 200", false, 200, ores.status());
  await owner.dispose();

  const ctx = await apiCtx(tokens.compliance_admin);
  const fake = crypto.randomUUID();
  const { count: before } = await db.from("map_cards").select("id", { count: "exact", head: true }).eq("organization_id", state.orgId);
  const idor = await ctx.post("/api/map-cards", { data: { title: "evil", obligation_id: fake } });
  expect("Flow7", "IDOR map-card foreign obligation -> 403", idor.status() === 403, 403, idor.status(), "Critical");
  const { count: after } = await db.from("map_cards").select("id", { count: "exact", head: true }).eq("organization_id", state.orgId);
  dbVal("idor map-card", "map_cards", "no row created by blocked IDOR", before === after, `before=${before} after=${after}`);

  const inv = await ctx.post("/api/obligations", { data: { description: "no title" } });
  expect("Flow7", "validation missing title -> 400", inv.status() === 400, 400, inv.status());

  const unauth = await apiCtx(null);
  const u = await unauth.get("/api/obligations");
  expect("Flow7", "unauthenticated -> 401", u.status() === 401, 401, u.status(), "Critical");
  await unauth.dispose();
  await ctx.dispose();
}

// ════════════════════════════════════════════════════════════════════════════
// Browser screenshots
// ════════════════════════════════════════════════════════════════════════════
async function injectSession(page, u) {
  const { token, user } = await signIn(u);
  const ref = new URL(SUPA_URL).hostname.split(".")[0];
  const key = `sb-${ref}-auth-token`;
  const payload = { access_token: token, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "qa", user };
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(({ k, v }) => window.localStorage.setItem(k, JSON.stringify(v)), { k: key, v: payload });
}

async function screenshotPass(browser) {
  console.log("\n=== Screenshot pass — all dashboards + feature pages per role ===");
  for (const u of USERS) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1024 } });
    const page = await ctx.newPage();
    const dir = path.join(shotsDir, u.role);
    fs.mkdirSync(dir, { recursive: true });
    try {
      await injectSession(page, u);
      const pages = ROLE_PAGES[u.role] || [u.dashboard];
      for (const p of pages) {
        const bucket = [];
        const onErr = (e) => bucket.push(e.message);
        page.on("pageerror", onErr);
        try {
          await page.goto(`${baseURL}${p}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
          await page.waitForLoadState("networkidle", { timeout: 12_000 }).catch(() => undefined);
          await page.locator("aside").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
          await page.waitForTimeout(900); // let charts/animation settle
          const body = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
          if (/Element type is invalid|Unhandled Runtime Error|Application error/i.test(body)) {
            defect("High", "UI", `Render crash on ${p} (${u.role})`, "no crash", "React/Next error");
          }
          if (bucket.length) defect("Medium", "UI", `Page error on ${p} (${u.role})`, "no pageerror", bucket[0]);
          // Data-rendering defect detectors (catch silently-empty widgets / bad bindings)
          if (/\bundefined\b/.test(body)) {
            defect("Medium", "UI-data", `"undefined" rendered on ${p} (${u.role})`, "no undefined text", "literal 'undefined' visible");
          }
          if (p === "/dashboard/compliance") {
            check("Dashboard-data", "compliance: Recent Activity populated", !/No recent activity/i.test(body), "activity rows", /No recent activity/i.test(body) ? "empty" : "populated") || defect("Medium", "UI-data", "Compliance dashboard Recent Activity empty", "rows", "empty");
          }
          if (p === "/dashboard/executive") {
            check("Dashboard-data", "executive: Active Escalations populated", !/No active escalations/i.test(body), "escalations", /No active escalations/i.test(body) ? "empty" : "populated") || defect("Low", "UI-data", "Executive dashboard escalations empty", "rows", "empty");
          }
          const file = path.join(dir, `${p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"}.png`);
          await page.screenshot({ path: file, fullPage: true });
          state.screenshots.push({ role: u.role, page: p, file: path.relative(root, file) });
          console.log(`  shot ${u.role} ${p}`);
        } catch (e) {
          defect("Medium", "UI", `Screenshot failed ${p} (${u.role})`, "screenshot", e instanceof Error ? e.message : String(e));
        } finally {
          page.off("pageerror", onErr);
        }
      }
    } catch (e) {
      defect("High", "Auth", `Browser login failed (${u.role})`, "login ok", e instanceof Error ? e.message : String(e));
    } finally {
      await ctx.close();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
function buildReport() {
  const pass = state.checks.filter((c) => c.status === "pass").length;
  const fail = state.checks.filter((c) => c.status === "fail").length;
  const dbPass = state.dbValidations.filter((d) => d.status === "pass").length;
  const dbFail = state.dbValidations.filter((d) => d.status === "fail").length;
  const sev = (s) => state.defects.filter((d) => d.severity === s).length;
  const L = [];
  L.push("# Suraksha OS — QA Report", "");
  L.push(`**Generated:** ${state.finishedAt}  `);
  L.push(`**Environment:** ${state.baseURL} · project \`${state.project}\` · org \`${state.orgId}\`  `);
  L.push(`**Harness:** \`scripts/qa-full-suite.cjs\` (\`npm run qa\`)`, "");
  L.push("## 1. Executive summary", "");
  L.push(`- Functional checks: **${pass} passed / ${fail} failed** (${state.checks.length} total)`);
  L.push(`- Database-state validations: **${dbPass} passed / ${dbFail} failed** (${state.dbValidations.length} total)`);
  L.push(`- Screenshots captured: **${state.screenshots.length}**`);
  L.push(`- Defects: **${state.defects.length}** — Critical: ${sev("Critical")}, High: ${sev("High")}, Medium: ${sev("Medium")}, Low: ${sev("Low")}`);
  L.push(`- Overall: **${fail === 0 && dbFail === 0 && sev("Critical") === 0 && sev("High") === 0 ? "PASS ✅" : "ATTENTION REQUIRED ⚠️"}**`, "");
  if (state.seed) {
    L.push("## 2. Seed data uploaded", "");
    L.push("| Entity | Count |", "|--------|------:|");
    for (const [k, v] of Object.entries(state.seed)) L.push(`| ${k} | ${v} |`);
    L.push("");
  }
  L.push("## 3. Business flow results", "");
  L.push("| Area | Check | Expected | Actual | Result |", "|------|-------|----------|--------|--------|");
  for (const c of state.checks) L.push(`| ${c.area} | ${c.name} | ${c.expected} | ${c.actual} | ${c.status === "pass" ? "✅" : "❌"} |`);
  L.push("");
  L.push("## 4. Database state validation (after each transaction)", "");
  L.push("| Transaction | Table | Expectation | Detail | Result |", "|-------------|-------|-------------|--------|--------|");
  for (const d of state.dbValidations) L.push(`| ${d.tx} | ${d.table} | ${d.expectation} | ${d.detail} | ${d.status === "pass" ? "✅" : "❌"} |`);
  L.push("");
  L.push("## 5. Defect log", "");
  if (state.defects.length === 0) {
    L.push("No defects detected. ✅", "");
  } else {
    L.push("| ID | Severity | Area | Title | Expected | Actual | Evidence |", "|----|----------|------|-------|----------|--------|----------|");
    for (const d of state.defects) L.push(`| ${d.id} | ${d.severity} | ${d.area} | ${d.title} | ${d.expected} | ${d.actual} | ${d.evidence || "—"} |`);
    L.push("");
  }
  L.push("## 6. Screenshot index", "");
  if (state.screenshots.length === 0) {
    L.push("_Browser pass skipped._", "");
  } else {
    let lastRole = null;
    for (const s of state.screenshots) {
      if (s.role !== lastRole) { L.push("", `### ${s.role}`, ""); lastRole = s.role; }
      L.push(`- \`${s.page}\` → \`${s.file}\``);
    }
    L.push("");
  }
  L.push("## 7. Coverage", "");
  L.push("- **Roles exercised:** " + USERS.map((u) => u.role).join(", "));
  L.push("- **Dashboards:** executive, compliance, security, audit, team, generic");
  L.push("- **Flows:** obligation lifecycle, evidence, MAP board, impact, drift, security findings, notifications, settings, readiness, ABAC/IDOR/validation");
  L.push("- **Layers:** UI (screenshots), API (HTTP), Database (service-role state checks)", "");
  return L.join("\n");
}

async function main() {
  fs.mkdirSync(shotsDir, { recursive: true });

  // 0. Seed
  if (!skipSeed) {
    console.log("=== Generating + uploading seed data ===");
    try {
      const out = execFileSync(process.execPath, [path.join("scripts", "seed-demo-data.cjs")], { cwd: root, encoding: "utf8" });
      const counts = {};
      for (const m of out.matchAll(/^(Documents|Obligations|Evidence|MAP cards|Escalations|Audit entries|Security findings|Notifications):\s*(\d+)/gim)) counts[m[1]] = Number(m[2]);
      state.seed = counts;
      console.log("Seed counts:", counts);
    } catch (e) {
      defect("High", "Seed", "Seed script failed", "seed ok", e instanceof Error ? e.message : String(e));
    }
  }

  await waitForServer();

  const org = await db.from("organizations").select("id").eq("slug", "suraksha-demo-bank").maybeSingle();
  state.orgId = org.data?.id || null;
  if (!state.orgId) defect("Critical", "Setup", "Demo org not found", "org exists", "missing");

  console.log("=== Signing in roles ===");
  const tokens = {};
  for (const u of USERS) {
    try { tokens[u.role] = (await signIn(u)).token; }
    catch (e) { defect("Critical", "Auth", `Cannot sign in ${u.role}`, "token", e instanceof Error ? e.message : String(e)); }
  }

  await flowObligationLifecycle(tokens);
  await flowImpactDrift(tokens);
  await flowSecurityFindings(tokens);
  await flowNotifications(tokens);
  await flowSettings(tokens);
  await flowReadiness(tokens);
  await flowAbacIdorValidation(tokens);

  if (!skipBrowser) {
    const browser = await chromium.launch({ headless });
    try { await screenshotPass(browser); } finally { await browser.close(); }
  }

  state.finishedAt = new Date().toISOString();
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "qa-report.json"), JSON.stringify(state, null, 2));
  const md = buildReport();
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "QA_REPORT.md"), md);

  const fail = state.checks.filter((c) => c.status === "fail").length + state.dbValidations.filter((d) => d.status === "fail").length;
  console.log("\n" + JSON.stringify({
    ok: fail === 0 && state.defects.filter((d) => ["Critical", "High"].includes(d.severity)).length === 0,
    checks: `${state.checks.filter((c) => c.status === "pass").length}/${state.checks.length}`,
    dbValidations: `${state.dbValidations.filter((d) => d.status === "pass").length}/${state.dbValidations.length}`,
    defects: state.defects.length,
    screenshots: state.screenshots.length,
    report: "docs/QA_REPORT.md",
    json: path.relative(root, path.join(outDir, "qa-report.json")),
  }, null, 2));
  if (fail > 0 || state.defects.some((d) => ["Critical", "High"].includes(d.severity))) process.exit(1);
}

main().catch((err) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "qa-failure.json"), JSON.stringify({ error: err instanceof Error ? err.stack : String(err) }, null, 2));
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
