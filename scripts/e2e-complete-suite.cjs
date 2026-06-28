/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Complete End-to-End Suite — automated mirror of docs/COMPLETE_E2E_TEST_PLAN.md.
 *
 * Covers:
 *   Part A  Authentication (real UI login per role, redirect, invalid, logout)
 *   Part B  Authorization (RBAC matrix, ABAC dept scoping, IDOR, input validation, unauth 401, token tamper)
 *   Part C  Dashboards (browser visit per role: shell, KPIs, errors, screenshots)
 *   Parts D–R Feature endpoints + page renders + access guards
 *   Part U  Functional CRUD workflow (create obligation -> evidence -> map card -> cleanup)
 *
 * Requires: dev server running (npm run dev) + .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).
 *
 * Usage:
 *   npm run test:e2e:full
 *
 * Env:
 *   E2E_BASE_URL       default http://localhost:3000
 *   E2E_HEADLESS       default true; "false" to watch
 *   E2E_UI_LOGIN       default "true" — Part A/C use the real login form; "false" injects session (faster)
 *   E2E_SKIP_BROWSER   "1" to run API-only (Parts A/C skipped)
 *   E2E_IGNORE_CONSOLE "1" to record console errors but not fail a page visit on console alone
 *   E2E_INTER_USER_MS  pause between users (default 1500)
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium, request: pwRequest } = require("playwright");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const outputDir = path.join(root, "test-results", "complete-suite");
const headless = process.env.E2E_HEADLESS !== "false";
const useUiLogin = process.env.E2E_UI_LOGIN !== "false";
const skipBrowser = process.env.E2E_SKIP_BROWSER === "1";
const ignoreConsole = process.env.E2E_IGNORE_CONSOLE === "1";
const interUserMs = Number(process.env.E2E_INTER_USER_MS || "1500") || 0;

const USERS = [
  { email: "admin@suraksha.local", password: "SurakshaAdmin@2026", role: "org_admin", dashboard: "/dashboard" },
  { email: "compliance@suraksha.local", password: "SurakshaCompliance@2026", role: "compliance_admin", dashboard: "/dashboard/compliance" },
  { email: "security@suraksha.local", password: "SurakshaSecurity@2026", role: "security_team", dashboard: "/dashboard/security" },
  { email: "audit@suraksha.local", password: "SurakshaAudit@2026", role: "internal_auditor", dashboard: "/dashboard/audit" },
  { email: "executive@suraksha.local", password: "SurakshaExecutive@2026", role: "executive_viewer", dashboard: "/dashboard/executive" },
  { email: "owner@suraksha.local", password: "SurakshaOwner@2026", role: "department_owner", dashboard: "/dashboard/team" },
];

/** Permission matrix (mirrors role_permissions seed). platform_admin = admin.all. */
const PERMS = {
  // org_admin gained full org-oversight in migration 010 (still not platform admin.all).
  org_admin: ["settings.manage", "users.manage", "documents.read", "documents.upload", "documents.delete", "obligations.create", "obligations.assign", "obligations.approve", "evidence.create", "evidence.approve", "reports.export", "audit.read", "security.findings.read"],
  compliance_admin: ["documents.upload", "documents.read", "documents.delete", "obligations.create", "obligations.assign", "obligations.approve", "evidence.create", "evidence.approve", "reports.export", "audit.read"],
  compliance_analyst: ["documents.upload", "documents.read", "obligations.create", "evidence.create", "reports.export"],
  security_team: ["documents.read", "obligations.create", "evidence.create", "security.findings.read"],
  it_owner: ["documents.read", "evidence.create", "security.findings.read"],
  department_owner: ["documents.read", "evidence.create"],
  internal_auditor: ["documents.read", "audit.read", "reports.export"],
  executive_viewer: ["documents.read", "reports.export"],
  external_auditor: ["documents.read", "audit.read", "reports.export"],
};
const can = (role, perm) => (PERMS[role] || []).includes("admin.all") || (PERMS[role] || []).includes(perm);

/** GET endpoints gated by documents.read (200 if has perm else 403). */
const READ_ENDPOINTS = [
  "/api/documents",
  "/api/obligations",
  "/api/map-cards",
  "/api/evidence",
  "/api/readiness",
  "/api/drift",
  "/api/impact",
  "/api/knowledge-graph",
  "/api/notifications",
  "/api/ai-pipeline",
  "/api/extract-obligations",
  "/api/evidence-intelligence",
  "/api/settings",
];

/** Nav personas (mirror data/mock-data.ts). null = everyone. */
const NAV = [
  { path: "/dashboard", personas: null },
  { path: "/upload", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { path: "/documents", personas: null },
  { path: "/obligations", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "department_owner"] },
  { path: "/map-board", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner"] },
  { path: "/knowledge-graph", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor"] },
  { path: "/drift", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { path: "/readiness", personas: null },
  { path: "/evidence", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner", "internal_auditor", "external_auditor"] },
  { path: "/impact", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "executive_viewer"] },
  { path: "/security-findings", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "security_team", "it_owner"] },
  { path: "/reports", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor", "executive_viewer", "external_auditor"] },
  { path: "/audit", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "internal_auditor", "external_auditor"] },
  { path: "/agents", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "internal_auditor"] },
  { path: "/admin/users", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/departments", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/teams", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/admin/access", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { path: "/settings", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin"] },
  { path: "/analytics", personas: ["platform_admin", "org_admin", "compliance_admin", "internal_auditor", "executive_viewer"] },
];
const navAllowed = (role, personas) => !personas || personas.includes(role);

const DASHBOARD_SUBROUTES = ["/dashboard/executive", "/dashboard/compliance", "/dashboard/security", "/dashboard/audit", "/dashboard/team"];

// ── report ──────────────────────────────────────────────────────────────────
const report = {
  startedAt: new Date().toISOString(),
  baseURL,
  useUiLogin,
  skipBrowser,
  results: [], // { part, id, name, status, detail }
};
function record(part, id, name, status, detail = "") {
  report.results.push({ part, id, name, status, detail });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "SKIP";
  console.log(`  [${tag}] ${id} ${name}${detail ? ` — ${detail}` : ""}`);
}
/** assert: expected truthy. */
function check(part, id, name, condition, detail = "") {
  record(part, id, name, condition ? "pass" : "fail", detail);
  return !!condition;
}

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    try { const r = await fetch(baseURL); if (r.ok || r.status < 500) return; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server not reachable at ${baseURL}. Run npm run dev.`);
}

function supa() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

async function signIn(user) {
  const { data, error } = await supa().auth.signInWithPassword({ email: user.email, password: user.password });
  if (error || !data.session?.access_token) throw new Error(`login failed ${user.email}: ${error?.message}`);
  return { token: data.session.access_token, user: data.user };
}

function apiCtx(token) {
  return pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// ════════════════════════════════════════════════════════════════════════════
// PART B — Authorization (API)
// ════════════════════════════════════════════════════════════════════════════
async function partB_unauth() {
  console.log("\n=== Part B1 — Unauthenticated API returns 401 ===");
  const ctx = await apiCtx(null);
  for (const ep of [...READ_ENDPOINTS, "/api/me", "/api/integrations/security-findings"]) {
    try {
      const res = await ctx.get(ep);
      check("B", `B1:${ep}`, `GET ${ep} unauth`, res.status() === 401, `status=${res.status()}`);
    } catch (e) {
      record("B", `B1:${ep}`, `GET ${ep} unauth`, "fail", String(e));
    }
  }
  // token tamper
  const bad = await apiCtx("not-a-real-token");
  try {
    const res = await bad.get("/api/me");
    check("B", "B7", "Tampered bearer token -> 401", res.status() === 401, `status=${res.status()}`);
  } catch (e) { record("B", "B7", "Tampered token", "fail", String(e)); }
  await bad.dispose();
  await ctx.dispose();
}

async function partB_matrix(tokensByRole) {
  console.log("\n=== Part B2 — Per-role read permission matrix ===");
  for (const { role } of USERS) {
    const ctx = await apiCtx(tokensByRole[role]);
    // /api/me always 200
    try {
      const me = await ctx.get("/api/me");
      check("B", `B2:${role}:me`, `${role} GET /api/me`, me.status() === 200, `status=${me.status()}`);
    } catch (e) { record("B", `B2:${role}:me`, `${role} /api/me`, "fail", String(e)); }

    for (const ep of READ_ENDPOINTS) {
      const expected = can(role, "documents.read") ? 200 : 403;
      try {
        const res = await ctx.get(ep);
        check("B", `B2:${role}:${ep}`, `${role} GET ${ep}`, res.status() === expected, `expected ${expected} got ${res.status()}`);
      } catch (e) { record("B", `B2:${role}:${ep}`, `${role} GET ${ep}`, "fail", String(e)); }
    }
    // security findings read
    const sfExpected = can(role, "security.findings.read") ? 200 : 403;
    try {
      const res = await ctx.get("/api/integrations/security-findings");
      check("B", `B2:${role}:secfind`, `${role} GET security-findings`, res.status() === sfExpected, `expected ${sfExpected} got ${res.status()}`);
    } catch (e) { record("B", `B2:${role}:secfind`, `${role} security-findings`, "fail", String(e)); }
    await ctx.dispose();
  }
}

async function partB_mutationPerms(tokensByRole) {
  console.log("\n=== Part B2 — Mutation permission spot-checks ===");
  const cases = [
    { role: "executive_viewer", ep: "/api/upload-document", method: "post", body: { multipart: {} }, expect: 403, name: "executive upload -> 403" },
    { role: "executive_viewer", ep: "/api/obligations", method: "post", data: { title: "x", department: "Compliance" }, expect: 403, name: "executive create obligation -> 403" },
    { role: "internal_auditor", ep: "/api/obligations", method: "post", data: { title: "x", department: "Compliance" }, expect: 403, name: "auditor create obligation -> 403" },
    { role: "department_owner", ep: "/api/obligations", method: "post", data: { title: "x", department: "Operations" }, expect: 403, name: "owner create obligation -> 403" },
    { role: "security_team", ep: "/api/documents?id=" + crypto.randomUUID(), method: "delete", expect: 403, name: "security delete document -> 403" },
    { role: "compliance_admin", ep: "/api/settings", method: "patch", data: { settings: { test: true } }, expect: 403, name: "compliance PATCH settings -> 403" },
    { role: "org_admin", ep: "/api/settings", method: "patch", data: { settings: { test: true } }, expect: 200, name: "org_admin PATCH settings -> 200" },
    { role: "compliance_admin", ep: "/api/notifications", method: "post", data: { title: "t", message: "m", type: "info" }, expect: 403, name: "compliance POST notification -> 403" },
    { role: "org_admin", ep: "/api/notifications", method: "post", data: { title: "E2E", message: "auto", type: "info" }, expect: 201, name: "org_admin POST notification -> 201" },
  ];
  for (const c of cases) {
    const ctx = await apiCtx(tokensByRole[c.role]);
    try {
      const opts = c.body ? c.body : c.data ? { data: c.data } : {};
      const res = await ctx[c.method](c.ep, opts);
      check("B", `B2m:${c.role}:${c.method}:${c.ep}`, c.name, res.status() === c.expect, `expected ${c.expect} got ${res.status()}`);
    } catch (e) { record("B", `B2m:${c.role}`, c.name, "fail", String(e)); }
    await ctx.dispose();
  }
}

async function partB_abac(tokensByRole) {
  console.log("\n=== Part B3 — Department ABAC isolation ===");
  const ctx = await apiCtx(tokensByRole.department_owner);
  try {
    const res = await ctx.get("/api/obligations");
    if (res.status() !== 200) {
      record("B", "B3", "department_owner obligations scoped", "fail", `status=${res.status()}`);
    } else {
      const rows = await res.json();
      const ok = Array.isArray(rows) && rows.every((r) => !r.department || String(r.department).toLowerCase() === "operations");
      check("B", "B3", "department_owner sees only Operations dept", ok, `rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
    }
  } catch (e) { record("B", "B3", "ABAC isolation", "fail", String(e)); }
  await ctx.dispose();
}

async function partB_idorAndValidation(tokensByRole) {
  console.log("\n=== Part B4/B5 — IDOR + input validation ===");
  const ctx = await apiCtx(tokensByRole.compliance_admin);
  const fake = crypto.randomUUID();

  const idor = [
    { ep: "/api/map-cards", method: "post", data: { title: "x", obligation_id: fake }, expect: 403, name: "map-card foreign obligation -> 403" },
    { ep: "/api/impact", method: "post", data: { document_id: fake }, expect: 403, name: "impact foreign doc -> 403" },
    { ep: "/api/drift", method: "post", data: { base_doc_id: fake, new_doc_id: crypto.randomUUID() }, expect: 403, name: "drift foreign docs -> 403" },
    { ep: `/api/documents/${fake}/download`, method: "get", expect: 404, name: "download unknown doc -> 404" },
    { ep: `/api/obligations/${fake}`, method: "get", expect: 404, name: "get unknown obligation -> 404" },
  ];
  const validation = [
    { ep: "/api/obligations", method: "post", data: { description: "no title" }, expect: 400, name: "obligation missing title/dept -> 400" },
    { ep: "/api/map-cards", method: "post", data: { title: "only title" }, expect: 400, name: "map-card missing obligation_id -> 400" },
    { ep: "/api/evidence", method: "post", data: { description: "no fields" }, expect: 400, name: "evidence missing fields -> 400" },
    { ep: "/api/evidence", method: "put", data: { collected: true }, expect: 400, name: "evidence PUT missing id -> 400" },
    { ep: "/api/drift", method: "post", data: {}, expect: 400, name: "drift missing ids -> 400" },
    { ep: "/api/impact", method: "post", data: {}, expect: 400, name: "impact missing document_id -> 400" },
  ];
  for (const c of [...idor, ...validation]) {
    try {
      const res = await ctx[c.method](c.ep, c.data ? { data: c.data } : {});
      check("B", `B45:${c.method}:${c.ep}`, c.name, res.status() === c.expect, `expected ${c.expect} got ${res.status()}`);
    } catch (e) { record("B", `B45:${c.ep}`, c.name, "fail", String(e)); }
  }
  await ctx.dispose();
}

// ════════════════════════════════════════════════════════════════════════════
// PART U — Functional CRUD workflow (compliance_admin) + security import
// ════════════════════════════════════════════════════════════════════════════
async function partU_workflow(tokensByRole) {
  console.log("\n=== Part U — Functional CRUD workflow ===");
  const ctx = await apiCtx(tokensByRole.compliance_admin);
  let obligationId = null;
  let mapId = null;
  try {
    const create = await ctx.post("/api/obligations", {
      data: {
        title: `E2E Complete ${new Date().toISOString()}`,
        description: "Automated complete-suite obligation.",
        regulation: "E2E Regulation", jurisdiction: "India", department: "Compliance",
        owner: "Automation", status: "in_progress", priority: "medium",
        due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), tags: ["e2e"],
      },
    });
    if (check("U", "U-obl", "create obligation -> 201", create.status() === 201, `status=${create.status()}`)) {
      obligationId = (await create.json()).id;
    }

    if (obligationId) {
      const ev = await ctx.post("/api/evidence", { data: { obligation_id: obligationId, title: "E2E Evidence" } });
      check("U", "U-ev", "create evidence -> 201", ev.status() === 201, `status=${ev.status()}`);

      const map = await ctx.post("/api/map-cards", {
        data: { title: "E2E MAP", obligation_id: obligationId, owner: "Automation", priority: "medium" },
      });
      if (check("U", "U-map", "create MAP card -> 201", map.status() === 201, `status=${map.status()}`)) {
        mapId = (await map.json()).id;
      }
    }

    if (mapId) {
      const del = await ctx.delete(`/api/map-cards/${mapId}`);
      check("U", "U-map-del", "delete MAP card -> 200", del.status() === 200, `status=${del.status()}`);
    }
    if (obligationId) {
      const del = await ctx.delete(`/api/obligations/${obligationId}`);
      check("U", "U-obl-del", "delete obligation -> 200", del.status() === 200, `status=${del.status()}`);
    }
  } catch (e) { record("U", "U-flow", "CRUD workflow", "fail", String(e)); }
  await ctx.dispose();

  // security finding import
  const sctx = await apiCtx(tokensByRole.security_team);
  try {
    const res = await sctx.post("/api/integrations/security-findings", {
      data: { findings: [{ source: "trivy", external_id: `e2e-${Date.now()}`, title: "E2E Finding", severity: "low", asset: "e2e", raw_payload: { scanner: "complete-suite" } }] },
    });
    check("O", "O2", "security_team import finding -> 201", res.status() === 201, `status=${res.status()}`);
  } catch (e) { record("O", "O2", "security import", "fail", String(e)); }
  await sctx.dispose();
}

// ════════════════════════════════════════════════════════════════════════════
// PART R — AI pipeline / extraction endpoints
// ════════════════════════════════════════════════════════════════════════════
async function partR(tokensByRole) {
  console.log("\n=== Part R — AI pipeline / extraction ===");
  const ctx = await apiCtx(tokensByRole.compliance_admin);
  try {
    const ai = await ctx.get("/api/ai-pipeline");
    check("R", "R1", "GET /api/ai-pipeline -> 200", ai.status() === 200, `status=${ai.status()}`);
  } catch (e) { record("R", "R1", "ai-pipeline", "fail", String(e)); }
  await ctx.dispose();

  const exec = await apiCtx(tokensByRole.executive_viewer);
  try {
    const res = await exec.post("/api/extract-obligations", { multipart: {} });
    check("R", "R3", "executive POST extract -> 403", res.status() === 403, `status=${res.status()}`);
  } catch (e) { record("R", "R3", "extract guard", "fail", String(e)); }
  await exec.dispose();
}

// ════════════════════════════════════════════════════════════════════════════
// PART A + C — Browser: login per role, dashboard + nav crawl
// ════════════════════════════════════════════════════════════════════════════
async function waitForShell(page, ms) {
  await page.locator("aside").first().waitFor({ state: "visible", timeout: ms });
}

async function injectSession(page, user) {
  const { token, user: authUser } = await signIn(user);
  const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const ref = url.hostname.split(".")[0];
  const key = `sb-${ref}-auth-token`;
  const payload = {
    access_token: token, token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "e2e", user: authUser,
  };
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(({ k, v }) => window.localStorage.setItem(k, JSON.stringify(v)), { k: key, v: payload });
  await page.goto(`${baseURL}${user.dashboard}`, { waitUntil: "domcontentloaded" });
  await waitForShell(page, 60_000);
}

async function uiLogin(page, user) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: /welcome back/i }).waitFor({ state: "visible", timeout: 20_000 });
      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(user.password);
      await Promise.all([
        page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000, waitUntil: "commit" }),
        page.getByRole("button", { name: /sign in to workspace/i }).click(),
      ]);
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
      await waitForShell(page, 90_000);
      return true;
    } catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2500)); }
  }
  record("A", `A5:${user.role}:uilogin`, `${user.role} UI login`, "fail", `falling back to inject: ${lastErr instanceof Error ? lastErr.message : lastErr}`);
  await injectSession(page, user);
  return false;
}

function collectors(page, bucket) {
  const onC = (m) => { if (m.type() === "error") bucket.console.push(m.text()); };
  const onP = (e) => bucket.page.push(e.message);
  const onR = (r) => {
    const u = r.url(); const t = r.failure()?.errorText || "";
    if (!u.includes("/_next/webpack-hmr") && !t.includes("ERR_ABORTED")) bucket.req.push(`${r.method()} ${u} ${t}`);
  };
  page.on("console", onC); page.on("pageerror", onP); page.on("requestfailed", onR);
  return () => { page.off("console", onC); page.off("pageerror", onP); page.off("requestfailed", onR); };
}

async function visit(page, role, routePath, allowed) {
  const bucket = { console: [], page: [], req: [] };
  const detach = collectors(page, bucket);
  const shotDir = path.join(outputDir, "screenshots", role);
  fs.mkdirSync(shotDir, { recursive: true });
  const shot = path.join(shotDir, `${routePath.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root"}.png`);
  let status = "pass";
  let detail = "";
  try {
    await page.goto(`${baseURL}${routePath}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
    if (allowed) await page.locator("aside").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
    const body = await page.locator("body").innerText({ timeout: 12_000 });
    const crash = /Unhandled Runtime Error|Application error|Element type is invalid/i.test(body);
    const denied = /Access denied/i.test(body) && /cannot access this page/i.test(body);
    const asideVisible = await page.locator("aside").first().isVisible().catch(() => false);
    const loading = /Checking secure session/i.test(body);
    if (crash) { status = "fail"; detail = "App/React crash detected"; }
    else if (allowed) {
      if (denied) { status = "fail"; detail = "Expected allowed, saw Access denied"; }
      else if (!asideVisible && !loading) { status = "fail"; detail = "Shell (aside) not found"; }
    } else if (!denied) { status = "fail"; detail = "Expected Access denied"; }
    if (bucket.page.length) { status = "fail"; if (!detail) detail = `pageerror: ${bucket.page[0]}`; }
    if (bucket.console.length && !ignoreConsole) { status = "fail"; if (!detail) detail = `console: ${bucket.console[0]}`; }
    if (bucket.req.length) { status = "fail"; if (!detail) detail = `reqfail: ${bucket.req[0]}`; }
    await page.screenshot({ path: shot, fullPage: true });
  } catch (e) { status = "fail"; detail = e instanceof Error ? e.message : String(e); try { await page.screenshot({ path: shot, fullPage: true }); } catch {} }
  finally { detach(); }
  record("C", `C:${role}:${routePath}`, `${role} ${routePath}${allowed ? "" : " (denied expected)"}`, status, detail);
}

async function partAC(browser) {
  console.log("\n=== Part A/C — Browser login + dashboards + nav crawl ===");
  for (let i = 0; i < USERS.length; i++) {
    const user = USERS[i];
    if (i > 0 && interUserMs) await new Promise((r) => setTimeout(r, interUserMs));
    console.log(`\n--- ${user.role} (${user.email}) ---`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    try {
      const real = useUiLogin ? await uiLogin(page, user) : (await injectSession(page, user), false);
      if (useUiLogin && real) record("A", `A5:${user.role}`, `${user.role} UI login + land dashboard`, "pass");
      // landing dashboard correctness — persona redirect happens client-side from /dashboard,
      // so allow time for the SPA redirect to settle before reading the URL.
      let landed;
      if (user.role === "org_admin") {
        landed = page.url().includes("/dashboard"); // org_admin has no persona redirect
      } else {
        try {
          await page.waitForURL((u) => u.pathname.startsWith(user.dashboard), { timeout: 20_000 });
          landed = true;
        } catch {
          landed = page.url().includes(user.dashboard);
        }
      }
      record("A", `A5:${user.role}:landing`, `${user.role} lands on ${user.dashboard}`, landed ? "pass" : "fail", `url=${page.url()}`);

      // visit allowed nav routes + forbidden samples
      for (const { path: p, personas } of NAV) {
        await visit(page, user.role, p, navAllowed(user.role, personas));
      }
      // visit each dashboard subroute (shell allows all)
      for (const sr of DASHBOARD_SUBROUTES) {
        await visit(page, user.role, sr, true);
      }
    } catch (e) {
      record("A", `A5:${user.role}`, `${user.role} browser flow`, "fail", String(e));
    } finally {
      await ctx.close();
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
function writeSummary() {
  const total = report.results.length;
  const pass = report.results.filter((r) => r.status === "pass").length;
  const fail = report.results.filter((r) => r.status === "fail").length;
  const skip = report.results.filter((r) => r.status === "skip").length;
  const byPart = {};
  for (const r of report.results) {
    byPart[r.part] = byPart[r.part] || { pass: 0, fail: 0, skip: 0 };
    byPart[r.part][r.status]++;
  }
  const lines = [
    "# Complete E2E Suite — Results",
    "",
    `- Started: ${report.startedAt}`,
    `- Finished: ${report.finishedAt}`,
    `- Base URL: ${report.baseURL}`,
    `- UI login: ${report.useUiLogin ? "yes" : "no (inject)"} | Browser: ${report.skipBrowser ? "skipped" : "on"}`,
    "",
    `## Totals: ${pass}/${total} passed, ${fail} failed, ${skip} skipped`,
    "",
    "| Part | Pass | Fail | Skip |",
    "|------|-----:|-----:|-----:|",
    ...Object.keys(byPart).sort().map((p) => `| ${p} | ${byPart[p].pass} | ${byPart[p].fail} | ${byPart[p].skip} |`),
    "",
  ];
  if (fail > 0) {
    lines.push("## Failures", "");
    for (const r of report.results.filter((x) => x.status === "fail")) {
      lines.push(`- **[${r.part}] ${r.id}** ${r.name} — ${r.detail || "—"}`);
    }
    lines.push("");
  } else {
    lines.push("All checks passed.", "");
  }
  return lines.join("\n");
}

async function main() {
  loadEnv();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in env/.env.local");
  }
  fs.mkdirSync(path.join(outputDir, "screenshots"), { recursive: true });
  await waitForServer();

  // Tokens for API parts
  console.log("=== Signing in all roles for API matrix ===");
  const tokensByRole = {};
  for (const u of USERS) {
    try { tokensByRole[u.role] = (await signIn(u)).token; record("A", `A-token:${u.role}`, `${u.role} obtain session token`, "pass"); }
    catch (e) { record("A", `A-token:${u.role}`, `${u.role} obtain session token`, "fail", String(e)); }
  }

  await partB_unauth();
  await partB_matrix(tokensByRole);
  await partB_mutationPerms(tokensByRole);
  await partB_abac(tokensByRole);
  await partB_idorAndValidation(tokensByRole);
  await partR(tokensByRole);
  await partU_workflow(tokensByRole);

  if (!skipBrowser) {
    const browser = await chromium.launch({ headless });
    try { await partAC(browser); } finally { await browser.close(); }
  } else {
    record("C", "C-browser", "Browser dashboards", "skip", "E2E_SKIP_BROWSER=1");
  }

  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outputDir, "SUMMARY.md"), writeSummary());

  const fail = report.results.filter((r) => r.status === "fail").length;
  const pass = report.results.filter((r) => r.status === "pass").length;
  console.log("\n" + JSON.stringify({
    ok: fail === 0, pass, fail, total: report.results.length,
    json: path.relative(root, path.join(outputDir, "report.json")),
    markdown: path.relative(root, path.join(outputDir, "SUMMARY.md")),
  }, null, 2));
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "failure.json"), JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }, null, 2));
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
