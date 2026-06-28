/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, request: playwrightRequest } = require("playwright");
const { createClient } = require("@supabase/supabase-js");
const { Client } = require("pg");

const root = process.cwd();
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
const outputDir = path.join(root, "test-results", "suraksha-e2e");

const users = [
  { email: "admin@suraksha.local", password: "SurakshaAdmin@2026", role: "org_admin", dashboard: "/dashboard" },
  { email: "compliance@suraksha.local", password: "SurakshaCompliance@2026", role: "compliance_admin", dashboard: "/dashboard/compliance" },
  { email: "security@suraksha.local", password: "SurakshaSecurity@2026", role: "security_team", dashboard: "/dashboard/security" },
  { email: "audit@suraksha.local", password: "SurakshaAudit@2026", role: "internal_auditor", dashboard: "/dashboard/audit" },
  { email: "executive@suraksha.local", password: "SurakshaExecutive@2026", role: "executive_viewer", dashboard: "/dashboard/executive" },
  { email: "owner@suraksha.local", password: "SurakshaOwner@2026", role: "department_owner", dashboard: "/dashboard/team" },
];

const allRoutes = [
  ["/dashboard", "Dashboard"],
  ["/dashboard/compliance", "Compliance Operations Dashboard"],
  ["/dashboard/security", "Security & IT Dashboard"],
  ["/dashboard/audit", "Internal Audit Dashboard"],
  ["/dashboard/executive", "Executive Dashboard"],
  ["/dashboard/team", "Department Owner Dashboard"],
  ["/upload", "Document Upload & Intake"],
  ["/documents", "Document Repository"],
  ["/obligations", "Obligations Repository"],
  ["/map-board", "MAP Board"],
  ["/knowledge-graph", "Compliance Knowledge Graph"],
  ["/drift", "Regulatory Drift Analyzer"],
  ["/readiness", "Compliance Readiness Scoring"],
  ["/evidence", "Evidence Intelligence"],
  ["/impact", "Impact Simulation"],
  ["/audit", "Audit Trail"],
  ["/analytics", "Risk & Analytics"],
  ["/reports", "Compliance Reports"],
  ["/settings", "Settings"],
];

const apiEndpoints = [
  { endpoint: "/api/documents", token: "compliance" },
  { endpoint: "/api/obligations", token: "compliance" },
  { endpoint: "/api/map-cards", token: "compliance" },
  { endpoint: "/api/evidence", token: "compliance" },
  { endpoint: "/api/readiness", token: "compliance" },
  { endpoint: "/api/drift", token: "compliance" },
  { endpoint: "/api/impact", token: "compliance" },
  { endpoint: "/api/knowledge-graph", token: "compliance" },
  { endpoint: "/api/notifications", token: "compliance" },
  { endpoint: "/api/ai-pipeline", token: "compliance" },
  { endpoint: "/api/integrations/security-findings", token: "security" },
];

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    if (!process.env[trimmed.slice(0, idx)]) {
      process.env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function slug(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 60_000) {
    try {
      const res = await fetch(baseURL);
      if (res.ok || res.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`App server is not reachable at ${baseURL}. Start it with npm run dev.`);
}

async function signInForToken(user) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error || !data.session?.access_token) {
    throw new Error(`Supabase login failed for ${user.email}: ${error?.message || "missing session"}`);
  }
  return data.session.access_token;
}

async function pageHealthCheck(page, route, expectedText, report) {
  const errors = [];
  const failedRequests = [];
  const onConsole = (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  };
  const onPageError = (err) => errors.push(err.message);
  const onRequestFailed = (req) => {
    const url = req.url();
    const errorText = req.failure()?.errorText || "";
    // Route transitions can abort old chunk/data requests in dev mode; those
    // are not user-visible failures and make the report noisy.
    if (!url.includes("/_next/webpack-hmr") && !errorText.includes("ERR_ABORTED")) {
      failedRequests.push(`${req.method()} ${url} ${errorText}`);
    }
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onRequestFailed);

  await page.goto(`${baseURL}${route}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForSelector("body", { state: "visible", timeout: 15_000 });

  const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
  ok(!/Unhandled Runtime Error|Application error|This page could not be found/i.test(bodyText), `${route} rendered an app error`);
  ok(bodyText.includes(expectedText), `${route} missing expected text: ${expectedText}`);

  if (route !== "/login") {
    await page.locator("header").first().waitFor({ state: "visible", timeout: 10_000 });
    await page.locator("aside").first().waitFor({ state: "visible", timeout: 10_000 });
  }

  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    main: (() => {
      const el = document.querySelector("main");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height };
    })(),
  }));
  ok(layout.main && layout.main.width > 300 && layout.main.height > 200, `${route} main layout is too small`);
  ok(layout.bodyScrollWidth <= layout.innerWidth + 80, `${route} has suspicious horizontal overflow`);

  const screenshotPath = path.join(outputDir, "screenshots", `${slug(route || "root") || "root"}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  page.off("console", onConsole);
  page.off("pageerror", onPageError);
  page.off("requestfailed", onRequestFailed);

  report.ui.push({
    route,
    expectedText,
    screenshot: path.relative(root, screenshotPath),
    consoleErrors: errors,
    failedRequests,
  });
}

async function loginInBrowser(page, user) {
  const token = await signInForToken(user);
  const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const projectRef = supabaseUrl.hostname.split(".")[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    throw new Error(`Could not resolve auth user for ${user.email}: ${error?.message || "missing user"}`);
  }
  const sessionPayload = {
    access_token: token,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "e2e-refresh-token",
    user: data.user,
  };

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.evaluate(
    ({ key, value }) => {
      window.localStorage.setItem(key, JSON.stringify(value));
    },
    { key: storageKey, value: sessionPayload }
  );
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Suraksha Compliance OS", { timeout: 20_000 });
}

async function loginThroughUi(page, user) {
  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /welcome back/i }).waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /sign in to workspace/i }).click();
  try {
    await page.waitForFunction(() => !window.location.pathname.startsWith("/login"), null, { timeout: 20_000 });
  } catch (err) {
    const body = await page.locator("body").innerText().catch(() => "");
    throw new Error(`Login did not leave /login for ${user.email}. Page text: ${body.slice(0, 500)}`);
  }
}

async function runPersonaChecks(browser, report) {
  for (const user of users) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    await loginInBrowser(page, user);
    await page.goto(`${baseURL}${user.dashboard}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    const bodyText = await page.locator("body").innerText();
    ok(bodyText.includes("Suraksha Compliance OS"), `${user.role} shell brand missing`);
    await page.screenshot({ path: path.join(outputDir, "personas", `${user.role}.png`), fullPage: true });
    report.personas.push({ email: user.email, role: user.role, dashboard: user.dashboard, ok: true });
    await context.close();
  }
}

async function runAllPageChecks(browser, report) {
  const user = users.find((u) => u.role === "compliance_admin");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await loginInBrowser(page, user);
  for (const [route, text] of allRoutes) {
    await pageHealthCheck(page, route, text, report);
  }

  await page.goto(`${baseURL}/upload`, { waitUntil: "domcontentloaded" });
  const invalidFile = path.join(outputDir, "fixtures", "invalid.txt");
  fs.mkdirSync(path.dirname(invalidFile), { recursive: true });
  fs.writeFileSync(invalidFile, "unsupported document type");
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.txt",
    mimeType: "text/plain",
    buffer: fs.readFileSync(invalidFile),
  });
  await page.waitForFunction(
    () => /not supported|unsupported|failed/i.test(document.body.innerText),
    null,
    { timeout: 10_000 }
  ).catch(() => undefined);
  const uploadText = await page.locator("body").innerText();
  ok(/not supported|unsupported|failed/i.test(uploadText), "Upload validation did not surface unsupported-file feedback");
  report.uiInteractions.push({ name: "upload_unsupported_file_validation", ok: true });

  await context.close();
}

async function runBackendChecks(report) {
  const compliance = users.find((u) => u.role === "compliance_admin");
  const security = users.find((u) => u.role === "security_team");
  const owner = users.find((u) => u.role === "department_owner");
  const executive = users.find((u) => u.role === "executive_viewer");
  const complianceToken = await signInForToken(compliance);
  const securityToken = await signInForToken(security);
  const ownerToken = await signInForToken(owner);
  const executiveToken = await signInForToken(executive);

  const unauthApi = await playwrightRequest.newContext({ baseURL });
  const unauthRes = await unauthApi.get("/api/documents");
  ok(unauthRes.status() === 401, `Unauthenticated /api/documents expected 401, got ${unauthRes.status()}`);
  report.functional.push({ name: "unauthenticated_api_returns_401", ok: true });
  await unauthApi.dispose();

  const api = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${complianceToken}` },
  });
  const securityApiForReads = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${securityToken}` },
  });

  for (const { endpoint, token } of apiEndpoints) {
    const context = token === "security" ? securityApiForReads : api;
    const res = await context.get(endpoint);
    ok(res.status() >= 200 && res.status() < 300, `${endpoint} returned ${res.status()}`);
    const text = await res.text();
    ok(text.length > 0, `${endpoint} returned empty body`);
    report.api.push({ endpoint, persona: token, status: res.status(), bytes: text.length });
  }

  const complianceForbiddenSecurity = await api.get("/api/integrations/security-findings");
  ok(complianceForbiddenSecurity.status() === 403, `Compliance token should not read security findings, got ${complianceForbiddenSecurity.status()}`);
  report.functional.push({ name: "role_forbidden_security_findings", ok: true });

  const ownerApi = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${ownerToken}` },
  });
  const ownerObligationsRes = await ownerApi.get("/api/obligations");
  ok(ownerObligationsRes.status() === 200, `Owner obligations read failed: ${ownerObligationsRes.status()}`);
  const ownerObligations = await ownerObligationsRes.json();
  ok(
    Array.isArray(ownerObligations) && ownerObligations.every((row) => !row.department || row.department === "Operations"),
    "Department owner saw obligations outside Operations department"
  );
  report.functional.push({ name: "department_owner_obligation_scope", visible: ownerObligations.length, ok: true });

  const executiveApi = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${executiveToken}` },
  });
  const executiveUpload = await executiveApi.post("/api/upload-document", { multipart: {} });
  ok(executiveUpload.status() === 403, `Executive upload should be forbidden, got ${executiveUpload.status()}`);
  report.functional.push({ name: "executive_upload_forbidden", ok: true });

  const title = `E2E Obligation ${new Date().toISOString()}`;
  const createObligation = await api.post("/api/obligations", {
    data: {
      title,
      description: "Automated end-to-end validation obligation.",
      regulation: "E2E Test Regulation",
      jurisdiction: "India",
      department: "Compliance",
      owner: "Automation",
      status: "in_progress",
      priority: "medium",
      due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      tags: ["e2e"],
    },
  });
  ok(createObligation.status() === 201, `Create obligation failed: ${createObligation.status()} ${await createObligation.text()}`);
  const obligation = await createObligation.json();
  report.functional.push({ name: "create_obligation", id: obligation.id, ok: true });

  const createEvidence = await api.post("/api/evidence", {
    data: {
      obligation_id: obligation.id,
      title: "E2E Evidence Item",
      description: "Created by automated test.",
    },
  });
  ok(createEvidence.status() === 201, `Create evidence failed: ${createEvidence.status()} ${await createEvidence.text()}`);
  const evidence = await createEvidence.json();
  report.functional.push({ name: "create_evidence", id: evidence.id, ok: true });

  const createMap = await api.post("/api/map-cards", {
    data: {
      title: "E2E MAP Card",
      obligation_id: obligation.id,
      owner: "Automation",
      priority: "medium",
      due_date: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    },
  });
  ok(createMap.status() === 201, `Create MAP card failed: ${createMap.status()} ${await createMap.text()}`);
  const mapCard = await createMap.json();
  report.functional.push({ name: "create_map_card", id: mapCard.id, ok: true });

  const securityApi = await playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${securityToken}` },
  });
  const finding = await securityApi.post("/api/integrations/security-findings", {
    data: {
      findings: [
        {
          source: "trivy",
          external_id: `e2e-${Date.now()}`,
          title: "E2E Trivy Finding",
          severity: "low",
          asset: "e2e-app",
          raw_payload: { scanner: "playwright" },
        },
      ],
    },
  });
  ok(finding.status() === 201, `Security finding import failed: ${finding.status()} ${await finding.text()}`);
  report.functional.push({ name: "import_security_finding", ok: true });

  const deleteMap = await api.delete(`/api/map-cards/${mapCard.id}`);
  ok(deleteMap.status() === 200, `Delete MAP card failed: ${deleteMap.status()}`);
  const deleteObligation = await api.delete(`/api/obligations/${obligation.id}`);
  ok(deleteObligation.status() === 200, `Delete obligation failed: ${deleteObligation.status()}`);
  report.functional.push({ name: "cleanup_created_obligation_and_map_card", ok: true });

  await api.dispose();
  await securityApiForReads.dispose();
  await securityApi.dispose();
  await ownerApi.dispose();
  await executiveApi.dispose();
}

async function runDatabaseChecks(report) {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const checks = [
    ["organizations", "id"],
    ["profiles", "id"],
    ["organization_members", "id"],
    ["role_permissions", "role"],
    ["documents", "id"],
    ["obligations", "id"],
    ["map_cards", "id"],
    ["evidence", "id"],
    ["document_chunks", "id"],
    ["extraction_reviews", "id"],
    ["integration_findings", "id"],
  ];

  for (const [table, column] of checks) {
    const { count, error } = await supabase.from(table).select(column, { count: "exact", head: true });
    ok(!error, `Supabase table check failed for ${table}: ${error?.message}`);
    report.database.restCounts[table] = count ?? 0;
  }

  if (!process.env.SUPABASE_DB_PASSWORD) {
    report.database.directPostgres = { skipped: true, reason: "SUPABASE_DB_PASSWORD not set" };
    return;
  }

  const client = new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-1-ap-southeast-2.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: `postgres.${process.env.SUPABASE_PROJECT_ID}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();
  const audit = await client.query(`
    select
      (select count(*)::int from pg_policies where schemaname in ('public','storage') and roles::text like '%anon%') as anon_policies,
      (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and n.nspname = 'public' and not c.relrowsecurity) as public_tables_without_rls,
      (select count(*)::int from public.role_permissions) as role_permissions,
      to_regclass('public.document_chunks') is not null as has_document_chunks,
      to_regclass('public.integration_findings') is not null as has_integration_findings,
      to_regprocedure('public.current_user_department(uuid)') is not null as has_department_abac,
      to_regprocedure('public.can_access_assigned_row(text, uuid, uuid, uuid)') is not null as has_assignment_abac
  `);
  await client.end();
  const row = audit.rows[0];
  ok(row.anon_policies === 0, `Expected 0 anon policies, got ${row.anon_policies}`);
  ok(row.public_tables_without_rls === 0, `Expected 0 public tables without RLS, got ${row.public_tables_without_rls}`);
  ok(row.role_permissions >= 35, `Expected at least 35 role permissions, got ${row.role_permissions}`);
  ok(row.has_document_chunks && row.has_integration_findings, "AI/integration tables missing");
  ok(row.has_department_abac && row.has_assignment_abac, "ABAC helper functions missing");
  report.database.directPostgres = row;
}

async function main() {
  loadEnv();
  fs.mkdirSync(path.join(outputDir, "screenshots"), { recursive: true });
  fs.mkdirSync(path.join(outputDir, "personas"), { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    baseURL,
    personas: [],
    ui: [],
    uiInteractions: [],
    api: [],
    functional: [],
    database: { restCounts: {} },
    failures: [],
  };

  await waitForServer();
  await runDatabaseChecks(report);
  await runBackendChecks(report);

  const browser = await chromium.launch({ headless: process.env.E2E_HEADLESS !== "false" });
  try {
    await runPersonaChecks(browser, report);
    await runAllPageChecks(browser, report);
  } finally {
    await browser.close();
  }

  report.finishedAt = new Date().toISOString();
  const reportPath = path.join(outputDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    ok: true,
    report: path.relative(root, reportPath),
    personas: report.personas.length,
    routes: report.ui.length,
    api: report.api.length,
    functional: report.functional.length,
    databaseTables: Object.keys(report.database.restCounts).length,
  }, null, 2));
}

main().catch((err) => {
  const failurePath = path.join(outputDir, "failure.json");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(failurePath, JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), stack: err?.stack }, null, 2));
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
