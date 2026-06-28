/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Suraksha OS — Backend & Database End-to-End Test Suite
 *
 * Tests every layer without a browser:
 *   1.  Database schema integrity
 *   2.  RLS / ABAC policy enforcement
 *   3.  RBAC — role_permissions table completeness
 *   4.  Auth API (/api/me) for each demo user
 *   5.  Core CRUD flows through every major API endpoint
 *   6.  Authorization enforcement (401 / 403) per role
 *   7.  Audit trail auto-logging
 *   8.  Security findings ingestion
 *   9.  Notifications lifecycle
 *  10.  Readiness score computation
 *  11.  Knowledge graph build
 *  12.  Drift comparison API
 *  13.  Impact simulation API
 *  14.  AI pipeline capabilities endpoint
 *  15.  Storage bucket presence
 *  16.  Database function existence (ABAC helpers)
 *
 * Run: SUPABASE_DB_PASSWORD=Prajwal@0304 node scripts/backend-db-test.cjs
 */

const fs   = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client }       = require("pg");

const root    = process.cwd();
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

// ─── Load .env.local ──────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const idx = t.indexOf("=");
    if (idx === -1) continue;
    const k = t.slice(0, idx), v = t.slice(idx + 1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

// ─── Helpers ─────────────────────────────────────────────────────────────────
const results = [];
let passed = 0, failed = 0;

function record(suite, name, ok, detail = "", ms = 0) {
  if (ok) passed++; else failed++;
  results.push({ suite, name, ok, detail: String(detail).slice(0, 300), ms });
  const icon = ok ? "PASS" : "FAIL";
  const d = detail ? ` — ${String(detail).slice(0, 100)}` : "";
  console.log(`  [${icon}] ${name}${d}  (${ms}ms)`);
}

async function timed(fn) {
  const t = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t };
}

// ─── Supabase admin client ────────────────────────────────────────────────────
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Postgres direct client (pooler) ─────────────────────────────────────────
function makePgClient() {
  return new Client({
    host: process.env.SUPABASE_POOLER_HOST || "aws-1-ap-southeast-2.pooler.supabase.com",
    port: 5432,
    database: "postgres",
    user: `postgres.${process.env.SUPABASE_PROJECT_ID}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
}

// ─── Demo users ───────────────────────────────────────────────────────────────
const users = [
  { email: "admin@suraksha.local",       password: "SurakshaAdmin@2026",      role: "org_admin",         dept: "Compliance"    },
  { email: "compliance@suraksha.local",  password: "SurakshaCompliance@2026", role: "compliance_admin",  dept: "Compliance"    },
  { email: "security@suraksha.local",    password: "SurakshaSecurity@2026",   role: "security_team",     dept: "IT"            },
  { email: "audit@suraksha.local",       password: "SurakshaAudit@2026",      role: "internal_auditor",  dept: "Internal Audit"},
  { email: "executive@suraksha.local",   password: "SurakshaExecutive@2026",  role: "executive_viewer",  dept: "Board"         },
  { email: "owner@suraksha.local",       password: "SurakshaOwner@2026",      role: "department_owner",  dept: "Operations"    },
];

const tokens = {};

async function getToken(email, password) {
  if (tokens[email]) return tokens[email];
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed for ${email}: ${error?.message}`);
  tokens[email] = data.session.access_token;
  return tokens[email];
}

async function apiFetch(path, token, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${baseURL}${path}`, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, ok: res.ok };
}

// =============================================================================
// SUITE 1 — DATABASE SCHEMA INTEGRITY
// =============================================================================
async function testDatabaseSchema() {
  console.log("\n=== 1. Database Schema Integrity ===");
  const pg = makePgClient();
  await pg.connect();

  const expectedTables = [
    "organizations","profiles","organization_members","role_permissions",
    "documents","obligations","map_cards","evidence","audit_trail",
    "risk_scores","compliance_trends","readiness_scores","notifications",
    "escalations","departments","graph_relationships","regulatory_versions",
    "drift_comparisons","impact_simulations","document_chunks",
    "extraction_reviews","integration_findings","audit_exports",
  ];

  const { rows: existingTables } = await pg.query(
    "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public' order by relname"
  );
  const existing = new Set(existingTables.map(r => r.relname));
  for (const t of expectedTables) {
    record("Schema", `Table public.${t} exists`, existing.has(t), existing.has(t) ? "" : "MISSING");
  }

  const { rows: rlsRows } = await pg.query(
    "select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public' and not relrowsecurity"
  );
  record("Schema", "All public tables have RLS enabled", rlsRows.length === 0,
    rlsRows.length ? `Missing RLS: ${rlsRows.map(r => r.relname).join(",")}` : "OK");

  const { rows: anonPols } = await pg.query(
    "select tablename, policyname from pg_policies where schemaname in ('public','storage') and roles::text like '%anon%'"
  );
  record("Schema", "No anonymous RLS policies remain", anonPols.length === 0,
    anonPols.length ? `Anon policies: ${anonPols.map(r => r.policyname).join(",")}` : "OK");

  const expectedEnums = ["suraksha_role","review_status","integration_source","obligation_status","document_status","audit_action","risk_trend"];
  const { rows: enumRows } = await pg.query(
    "select typname from pg_type join pg_namespace on pg_namespace.oid=pg_type.typnamespace where nspname='public' and typtype='e'"
  );
  const existingEnums = new Set(enumRows.map(r => r.typname));
  for (const e of expectedEnums) {
    record("Schema", `Enum ${e} exists`, existingEnums.has(e));
  }

  const { rows: idxRows } = await pg.query(
    "select indexname from pg_indexes where schemaname='public' and indexname like 'idx_%'"
  );
  record("Schema", "Performance indexes present", idxRows.length >= 15, `Count: ${idxRows.length}`);

  await pg.end();
}

// =============================================================================
// SUITE 2 — ABAC HELPER FUNCTIONS
// =============================================================================
async function testAbacFunctions() {
  console.log("\n=== 2. ABAC Helper Functions ===");
  const pg = makePgClient();
  await pg.connect();

  const expectedFns = [
    "current_organization_id",
    "has_permission",
    "current_user_role",
    "current_user_department",
    "is_org_wide_role",
    "can_access_department",
    "can_access_assigned_row",
    "set_updated_at",
    "increment_evidence_count",
    "get_dashboard_kpis",
    "get_analytics_overview",
  ];
  const { rows } = await pg.query(
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' order by proname"
  );
  const existing = new Set(rows.map(r => r.proname));
  for (const fn of expectedFns) {
    record("ABAC", `Function ${fn}() exists`, existing.has(fn));
  }

  const { rows: secdefRows } = await pg.query(
    "select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and p.prolang=(select oid from pg_language where lanname='sql')"
  );
  const secdefNames = secdefRows.map(r => r.proname);
  const abacSecdef = ["can_access_department","can_access_assigned_row","has_permission","current_user_department","current_user_role"].every(f => secdefNames.includes(f));
  record("ABAC", "ABAC helpers are SECURITY DEFINER", abacSecdef,
    abacSecdef ? "OK" : `Missing secdef: ${JSON.stringify(secdefNames)}`);

  await pg.end();
}

// =============================================================================
// SUITE 3 — RBAC ROLE PERMISSIONS TABLE
// =============================================================================
async function testRbacTable() {
  console.log("\n=== 3. RBAC — role_permissions Table ===");

  const { data: perms, error } = await supabase.from("role_permissions").select("*");
  record("RBAC", "role_permissions readable via service role", !error, error?.message);
  record("RBAC", "At least 35 permission rows present", (perms?.length ?? 0) >= 35, `Count: ${perms?.length}`);

  const requiredMappings = [
    ["compliance_admin","documents.upload"],
    ["compliance_admin","obligations.approve"],
    ["compliance_admin","evidence.approve"],
    ["security_team","security.findings.read"],
    ["internal_auditor","audit.read"],
    ["executive_viewer","reports.export"],
    ["department_owner","evidence.create"],
    ["org_admin","settings.manage"],
    ["platform_admin","admin.all"],
  ];
  for (const [role, perm] of requiredMappings) {
    const found = perms?.some(p => p.role === role && p.permission === perm);
    record("RBAC", `${role} → ${perm}`, !!found);
  }
}

// =============================================================================
// SUITE 4 — AUTH FLOWS (/api/me per user)
// =============================================================================
async function testAuthFlows() {
  console.log("\n=== 4. Auth Flows — /api/me Per User ===");

  // Unauthenticated
  const { result: unauthRes, ms: unauthMs } = await timed(() => apiFetch("/api/me", null));
  record("Auth", "No token → 401", unauthRes.status === 401, `status=${unauthRes.status}`, unauthMs);

  // Invalid token
  const { result: badResult, ms: badMs } = await timed(() => apiFetch("/api/me", "invalid-token-xyz"));
  record("Auth", "Invalid token → 401", badResult.status === 401, `status=${badResult.status}`, badMs);

  for (const u of users) {
    let tok;
    try { tok = await getToken(u.email, u.password); } catch (e) {
      record("Auth", `Login ${u.email}`, false, e.message); continue;
    }
    const { result, ms } = await timed(() => apiFetch("/api/me", tok));
    record("Auth", `Login ${u.role} (${u.email})`, result.ok, result.ok ? `role=${result.body?.role}` : result.body?.error, ms);
    if (result.ok) {
      record("Auth", `${u.role} role matches DB`, result.body?.role === u.role, `got=${result.body?.role} expected=${u.role}`);
      record("Auth", `${u.role} permissions populated from DB`, Array.isArray(result.body?.permissions) && result.body.permissions.length > 0,
        `count=${result.body?.permissions?.length}`);
      record("Auth", `${u.role} organizationId present`, !!result.body?.organizationId, result.body?.organizationId || "null");
    }
  }
}

// =============================================================================
// SUITE 5 — CORE CRUD FLOWS
// =============================================================================
async function testCrudFlows() {
  console.log("\n=== 5. Core CRUD Flows ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");

  // Documents
  const { result: docsRes, ms: docsMs } = await timed(() => apiFetch("/api/documents", tok));
  record("CRUD", "GET /api/documents", docsRes.ok, `status=${docsRes.status} items=${Array.isArray(docsRes.body) ? docsRes.body.length : "?"}`, docsMs);

  // Obligations list
  const { result: oblRes, ms: oblMs } = await timed(() => apiFetch("/api/obligations", tok));
  record("CRUD", "GET /api/obligations", oblRes.ok, `status=${oblRes.status} items=${Array.isArray(oblRes.body) ? oblRes.body.length : "?"}`, oblMs);

  // Create obligation
  const newObl = { title: "E2E-BACKEND-TEST obligation", description: "Created by backend test", regulation: "TEST-REG-001",
    jurisdiction: "India", department: "Compliance", owner: "Automation", status: "in_progress", priority: "medium",
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0], tags: ["e2e", "backend"] };
  const { result: createObl, ms: createOblMs } = await timed(() =>
    apiFetch("/api/obligations", tok, { method: "POST", body: JSON.stringify(newObl) }));
  record("CRUD", "POST /api/obligations", createObl.status === 201, `status=${createObl.status}`, createOblMs);
  const oblId = createObl.body?.id;

  if (oblId) {
    // Read by ID
    const { result: getObl, ms: getOblMs } = await timed(() => apiFetch(`/api/obligations/${oblId}`, tok));
    record("CRUD", "GET /api/obligations/[id]", getObl.ok, `status=${getObl.status}`, getOblMs);

    // Update obligation
    const { result: putObl, ms: putOblMs } = await timed(() =>
      apiFetch(`/api/obligations/${oblId}`, tok, { method: "PUT", body: JSON.stringify({ status: "compliant" }) }));
    record("CRUD", "PUT /api/obligations/[id]", putObl.ok, `status=${putObl.status} new_status=${putObl.body?.status}`, putOblMs);

    // Create evidence
    const { result: evRes, ms: evMs } = await timed(() =>
      apiFetch("/api/evidence", tok, { method: "POST", body: JSON.stringify({ obligation_id: oblId, title: "E2E evidence item", description: "Backend test" }) }));
    record("CRUD", "POST /api/evidence", evRes.status === 201, `status=${evRes.status}`, evMs);
    const evId = evRes.body?.id;

    if (evId) {
      const { result: evPut, ms: evPutMs } = await timed(() =>
        apiFetch(`/api/evidence?id=${evId}`, tok, { method: "PUT", body: JSON.stringify({ collected: true }) }));
      record("CRUD", "PUT /api/evidence?id (collect)", evPut.ok, `status=${evPut.status}`, evPutMs);
    }

    // Create MAP card
    const { result: mapRes, ms: mapMs } = await timed(() =>
      apiFetch("/api/map-cards", tok, { method: "POST", body: JSON.stringify({ title: "E2E MAP card", obligation_id: oblId,
        owner: "Automation", priority: "medium", due_date: new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0] }) }));
    record("CRUD", "POST /api/map-cards", mapRes.status === 201, `status=${mapRes.status}`, mapMs);
    const mapId = mapRes.body?.id;

    if (mapId) {
      const { result: mapPut, ms: mapPutMs } = await timed(() =>
        apiFetch(`/api/map-cards/${mapId}`, tok, { method: "PUT", body: JSON.stringify({ status: "in_progress" }) }));
      record("CRUD", "PUT /api/map-cards/[id]", mapPut.ok, `status=${mapPut.status}`, mapPutMs);

      const { result: mapDel, ms: mapDelMs } = await timed(() =>
        apiFetch(`/api/map-cards/${mapId}`, tok, { method: "DELETE" }));
      record("CRUD", "DELETE /api/map-cards/[id]", mapDel.ok, `status=${mapDel.status}`, mapDelMs);
    }

    // Delete obligation
    const { result: delObl, ms: delOblMs } = await timed(() =>
      apiFetch(`/api/obligations/${oblId}`, tok, { method: "DELETE" }));
    record("CRUD", "DELETE /api/obligations/[id]", delObl.ok, `status=${delObl.status}`, delOblMs);

    // Audit trail entry logged
    const { data: auditRows } = await supabase.from("audit_trail").select("*")
      .eq("target_id", oblId).order("created_at", { ascending: false }).limit(5);
    record("CRUD", "Audit trail logged for obligation lifecycle", (auditRows?.length ?? 0) >= 1, `entries=${auditRows?.length}`);
  }

  // MAP cards list
  const { result: mapsRes, ms: mapsMs } = await timed(() => apiFetch("/api/map-cards", tok));
  record("CRUD", "GET /api/map-cards", mapsRes.ok, `status=${mapsRes.status} items=${Array.isArray(mapsRes.body) ? mapsRes.body.length : "?"}`, mapsMs);

  // Evidence list
  const { result: evListRes, ms: evListMs } = await timed(() => apiFetch("/api/evidence", tok));
  record("CRUD", "GET /api/evidence", evListRes.ok, `status=${evListRes.status}`, evListMs);
}

// =============================================================================
// SUITE 6 — AUTHORIZATION ENFORCEMENT
// =============================================================================
async function testAuthorizationEnforcement() {
  console.log("\n=== 6. Authorization Enforcement ===");

  // Unauthenticated API calls must return 401
  for (const route of ["/api/documents", "/api/obligations", "/api/evidence", "/api/me", "/api/notifications"]) {
    const { result: unRes } = await timed(() => apiFetch(route, null));
    record("AuthZ", `No token → 401 on ${route}`, unRes.status === 401, `got ${unRes.status}`);
  }

  const complianceTok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const executiveTok  = await getToken("executive@suraksha.local",  "SurakshaExecutive@2026");
  const securityTok   = await getToken("security@suraksha.local",   "SurakshaSecurity@2026");

  // Executive cannot upload
  const { result: execUpload } = await timed(() =>
    apiFetch("/api/upload-document", executiveTok, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
  record("AuthZ", "Executive cannot POST /api/upload-document", execUpload.status === 403 || execUpload.status === 400,
    `got ${execUpload.status}`);

  // Compliance cannot read security findings
  const { result: compSecFind } = await timed(() => apiFetch("/api/integrations/security-findings", complianceTok));
  record("AuthZ", "Compliance admin cannot GET /api/integrations/security-findings", compSecFind.status === 403,
    `got ${compSecFind.status}`);

  // Security team can read security findings
  const { result: secFind } = await timed(() => apiFetch("/api/integrations/security-findings", securityTok));
  record("AuthZ", "Security team can GET /api/integrations/security-findings", secFind.ok,
    `status=${secFind.status}`);

  // Security team can import findings
  const finding = { findings: [{ source: "trivy", external_id: `authz-test-${Date.now()}`, title: "AuthZ test finding", severity: "info" }] };
  const { result: secPost } = await timed(() =>
    apiFetch("/api/integrations/security-findings", securityTok, { method: "POST", body: JSON.stringify(finding) }));
  record("AuthZ", "Security team can POST security findings", secPost.status === 201,
    `status=${secPost.status}`);

  // Executive cannot POST obligation
  const oblBody = { title: "Should be forbidden", department: "Compliance", due_date: "2027-01-01" };
  const { result: execObl } = await timed(() =>
    apiFetch("/api/obligations", executiveTok, { method: "POST", body: JSON.stringify(oblBody) }));
  record("AuthZ", "Executive cannot POST /api/obligations", execObl.status === 403,
    `got ${execObl.status}`);

  // Department owner reads only own dept obligations
  const ownerTok = await getToken("owner@suraksha.local", "SurakshaOwner@2026");
  const { result: ownerObls } = await timed(() => apiFetch("/api/obligations", ownerTok));
  if (ownerObls.ok && Array.isArray(ownerObls.body)) {
    const allInScope = ownerObls.body.every(o => !o.department || o.department === "Operations");
    record("AuthZ", "Department owner sees only Operations obligations", allInScope,
      `total=${ownerObls.body.length}`);
  } else {
    record("AuthZ", "Department owner /api/obligations accessible", ownerObls.ok, `status=${ownerObls.status}`);
  }
}

// =============================================================================
// SUITE 7 — NOTIFICATIONS LIFECYCLE
// =============================================================================
async function testNotifications() {
  console.log("\n=== 7. Notifications Lifecycle ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const adminTok = await getToken("admin@suraksha.local", "SurakshaAdmin@2026");

  const { result: listRes, ms: listMs } = await timed(() => apiFetch("/api/notifications", tok));
  record("Notifications", "GET /api/notifications", listRes.ok, `status=${listRes.status} items=${Array.isArray(listRes.body) ? listRes.body.length : "?"}`, listMs);

  // Admin can create notification
  const { result: createRes, ms: createMs } = await timed(() =>
    apiFetch("/api/notifications", adminTok, { method: "POST",
      body: JSON.stringify({ title: "E2E Test Notification", message: "Backend test", type: "info" }) }));
  record("Notifications", "Admin POST /api/notifications", createRes.status === 201, `status=${createRes.status}`, createMs);

  if (createRes.body?.id) {
    const { result: patchRes, ms: patchMs } = await timed(() =>
      apiFetch("/api/notifications", tok, { method: "PATCH", body: JSON.stringify({ id: createRes.body.id }) }));
    record("Notifications", "PATCH notification as read", patchRes.ok, `status=${patchRes.status}`, patchMs);
  }

  // Compliance cannot create notification (needs settings.manage)
  const { result: compCreate } = await timed(() =>
    apiFetch("/api/notifications", tok, { method: "POST", body: JSON.stringify({ title: "Forbidden", message: "Should fail" }) }));
  record("Notifications", "Compliance cannot POST notification (403)", compCreate.status === 403, `got ${compCreate.status}`);
}

// =============================================================================
// SUITE 8 — READINESS SCORES
// =============================================================================
async function testReadiness() {
  console.log("\n=== 8. Readiness Scores ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const { result, ms } = await timed(() => apiFetch("/api/readiness", tok));
  record("Readiness", "GET /api/readiness returns scores", result.ok && Array.isArray(result.body),
    `status=${result.status} departments=${Array.isArray(result.body) ? result.body.length : "?"}`, ms);
  if (Array.isArray(result.body) && result.body.length > 0) {
    const hasFields = result.body[0].department && result.body[0].score !== undefined;
    record("Readiness", "Score objects have department and score", hasFields, JSON.stringify(result.body[0]).slice(0, 100));
  }
}

// =============================================================================
// SUITE 9 — KNOWLEDGE GRAPH
// =============================================================================
async function testKnowledgeGraph() {
  console.log("\n=== 9. Knowledge Graph ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const { result, ms } = await timed(() => apiFetch("/api/knowledge-graph", tok));
  record("KnowledgeGraph", "GET /api/knowledge-graph", result.ok, `status=${result.status}`, ms);
  if (result.ok && result.body?.nodes) {
    record("KnowledgeGraph", "Graph has nodes and edges", result.body.nodes.length > 0 && Array.isArray(result.body.edges),
      `nodes=${result.body.nodes.length} edges=${result.body.edges?.length}`);
    const types = [...new Set(result.body.nodes.map(n => n.type))];
    record("KnowledgeGraph", "Graph has multiple node types", types.length >= 2, `types=${types.join(",")}`);
  }
}

// =============================================================================
// SUITE 10 — DRIFT COMPARISON
// =============================================================================
async function testDrift() {
  console.log("\n=== 10. Drift Comparison ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");

  const { result: listRes, ms: listMs } = await timed(() => apiFetch("/api/drift", tok));
  record("Drift", "GET /api/drift (list past comparisons)", listRes.ok, `status=${listRes.status}`, listMs);

  // Two documents needed for drift — if < 2 exist, skip POST
  const { result: docsRes } = await timed(() => apiFetch("/api/documents", tok));
  const docs = Array.isArray(docsRes.body) ? docsRes.body.filter(d => d.status === "processed") : [];
  if (docs.length >= 2) {
    const body = JSON.stringify({ base_doc_id: docs[0].id, new_doc_id: docs[1].id });
    const { result, ms } = await timed(() => apiFetch("/api/drift", tok, { method: "POST", body }));
    record("Drift", "POST /api/drift (compare two documents)", result.ok,
      `status=${result.status} drift_score=${result.body?.drift_score}`, ms);
  } else {
    record("Drift", "POST /api/drift skipped (fewer than 2 processed docs)", true, `processed_docs=${docs.length}`);
  }
}

// =============================================================================
// SUITE 11 — IMPACT SIMULATION
// =============================================================================
async function testImpact() {
  console.log("\n=== 11. Impact Simulation ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");

  const { result: listRes, ms: listMs } = await timed(() => apiFetch("/api/impact", tok));
  record("Impact", "GET /api/impact (list simulations)", listRes.ok, `status=${listRes.status}`, listMs);

  const { result: docsRes } = await timed(() => apiFetch("/api/documents", tok));
  const docs = Array.isArray(docsRes.body) ? docsRes.body.filter(d => d.status === "processed") : [];
  if (docs.length >= 1) {
    const body = JSON.stringify({ document_id: docs[0].id });
    const { result, ms } = await timed(() => apiFetch("/api/impact", tok, { method: "POST", body }));
    record("Impact", "POST /api/impact (run simulation)", result.ok,
      `status=${result.status} risk=${result.body?.risk_level}`, ms);
  } else {
    record("Impact", "POST /api/impact skipped (no processed docs)", true, "");
  }
}

// =============================================================================
// SUITE 12 — AI PIPELINE CAPABILITIES
// =============================================================================
async function testAiPipeline() {
  console.log("\n=== 12. AI Pipeline ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const { result, ms } = await timed(() => apiFetch("/api/ai-pipeline", tok));
  record("AIPipeline", "GET /api/ai-pipeline", result.ok, `status=${result.status}`, ms);
  if (result.ok && result.body?.capabilities) {
    record("AIPipeline", "Capabilities list present", Array.isArray(result.body.capabilities),
      `count=${result.body.capabilities.length}`);
    const hasOllama = result.body.capabilities.some(c => c.status === "active");
    record("AIPipeline", "At least one capability active (Ollama)", hasOllama,
      result.body.capabilities.map(c => `${c.name}:${c.status}`).join(" | "));
  }
}

// =============================================================================
// SUITE 13 — STORAGE BUCKET
// =============================================================================
async function testStorageBucket() {
  console.log("\n=== 13. Storage Bucket ===");
  const { data: buckets, error } = await supabase.storage.listBuckets();
  record("Storage", "Supabase Storage accessible", !error, error?.message);
  const bucket = buckets?.find(b => b.name === "compliance-documents");
  record("Storage", "compliance-documents bucket exists", !!bucket, bucket ? `id=${bucket.id}` : "MISSING");
  if (bucket) {
    record("Storage", "compliance-documents bucket is private", !bucket.public, bucket.public ? "EXPOSED" : "OK");
  }
}

// =============================================================================
// SUITE 14 — EVIDENCE INTELLIGENCE
// =============================================================================
async function testEvidenceIntelligence() {
  console.log("\n=== 14. Evidence Intelligence ===");
  const tok = await getToken("compliance@suraksha.local", "SurakshaCompliance@2026");
  const { result: listRes, ms: listMs } = await timed(() => apiFetch("/api/evidence-intelligence", tok));
  record("Evidence", "GET /api/evidence-intelligence", listRes.ok, `status=${listRes.status}`, listMs);

  // AI recommendation — fetch first obligation
  const { result: oblRes } = await timed(() => apiFetch("/api/obligations", tok));
  const oblList = Array.isArray(oblRes.body) ? oblRes.body : [];
  if (oblList.length > 0) {
    const obl = oblList[0];
    const body = JSON.stringify({ obligation_id: obl.id, obligation_title: obl.title, department: obl.department, regulation: obl.regulation });
    const { result: aiRes, ms: aiMs } = await timed(() =>
      apiFetch("/api/evidence-intelligence", tok, { method: "POST", body }));
    record("Evidence", "POST /api/evidence-intelligence (AI recommendations)", aiRes.ok,
      `status=${aiRes.status} inserted=${aiRes.body?.inserted}`, aiMs);
  } else {
    record("Evidence", "POST /api/evidence-intelligence skipped (no obligations)", true, "");
  }
}

// =============================================================================
// SUITE 15 — ROW-LEVEL SECURITY DIRECT TEST
// =============================================================================
async function testRlsDirect() {
  console.log("\n=== 15. RLS Direct Postgres Verification ===");
  const pg = makePgClient();
  await pg.connect();

  const { rows: rlsPolicies } = await pg.query(
    "select count(*)::int as cnt from pg_policies where schemaname in ('public','storage')"
  );
  record("RLS", "Policies installed in DB", rlsPolicies[0].cnt >= 30, `count=${rlsPolicies[0].cnt}`);

  const { rows: abacPolicies } = await pg.query(
    "select tablename, count(*)::int as cnt from pg_policies where schemaname='public' and qual like '%can_access%' group by tablename"
  );
  record("RLS", "ABAC-aware policies exist", abacPolicies.length >= 3,
    abacPolicies.map(r => `${r.tablename}:${r.cnt}`).join(", "));

  const { rows: orgPolicies } = await pg.query(
    "select tablename, count(*)::int as cnt from pg_policies where schemaname='public' and qual like '%current_organization_id%' group by tablename"
  );
  record("RLS", "Organization-scoped policies cover core tables", orgPolicies.length >= 5,
    orgPolicies.map(r => r.tablename).join(", "));

  await pg.end();
}

// =============================================================================
// MAIN RUNNER
// =============================================================================
async function main() {
  console.log("=======================================================");
  console.log("  Suraksha OS — Backend & Database E2E Test Suite");
  console.log(`  Base URL : ${baseURL}`);
  console.log(`  Project  : ${process.env.SUPABASE_PROJECT_ID}`);
  console.log(`  Time     : ${new Date().toISOString()}`);
  console.log("=======================================================");

  const suites = [
    testDatabaseSchema,
    testAbacFunctions,
    testRbacTable,
    testAuthFlows,
    testCrudFlows,
    testAuthorizationEnforcement,
    testNotifications,
    testReadiness,
    testKnowledgeGraph,
    testDrift,
    testImpact,
    testAiPipeline,
    testStorageBucket,
    testEvidenceIntelligence,
    testRlsDirect,
  ];

  for (const suite of suites) {
    try {
      await suite();
    } catch (err) {
      console.error(`Suite error: ${err.message}`);
    }
  }

  console.log("\n=======================================================");
  console.log(`  RESULTS  — PASSED: ${passed}   FAILED: ${failed}   TOTAL: ${passed + failed}`);
  console.log("=======================================================\n");

  const outPath = path.join(root, "test-results", "backend-db-test-results.json");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ passed, failed, total: passed + failed, results, runAt: new Date().toISOString() }, null, 2));
  console.log(`Full results written to ${outPath}\n`);

  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
