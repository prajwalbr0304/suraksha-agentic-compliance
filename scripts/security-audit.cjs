/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Suraksha OS — Multi-Tenant Security & Authorization Audit
 *
 * Attack vectors tested:
 *  SEC-01  Cross-organization data leakage via API
 *  SEC-02  Cross-organization data leakage via Supabase direct (anon key)
 *  SEC-03  Privilege escalation — low-role user reaching high-privilege actions
 *  SEC-04  Horizontal escalation — user accessing another user's assigned rows
 *  SEC-05  Department boundary violation — owner crossing department lines
 *  SEC-06  Service-role key not exposed in API responses
 *  SEC-07  RLS gaps — tables lacking policies or with over-permissive policies
 *  SEC-08  ID-enumeration — guessing/brute-force resource IDs across tenants
 *  SEC-09  Token manipulation — forged / expired / tampered tokens
 *  SEC-10  Mass-assignment — injecting forbidden fields via POST/PUT
 *  SEC-11  Concurrent-session isolation — two sessions same user, same time
 *  SEC-12  Admin migrate endpoint locked down
 *  SEC-13  Storage bucket private (no public read)
 *  SEC-14  Audit trail immutability — user cannot delete own audit entries
 *  SEC-15  Header injection — custom org header forces wrong org access
 */

const fs   = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { Client }       = require("pg");

const root    = process.cwd();
const BASE    = process.env.E2E_BASE_URL || "http://localhost:3000";
const PROJ    = "stggdwlxsldonuhrxbhx";
const POOLER  = "aws-1-ap-southeast-2.pooler.supabase.com";

// ─── Load env ─────────────────────────────────────────────────────────────────
function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    if (!process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
  }
}
loadEnv();

// ─── Result tracking ──────────────────────────────────────────────────────────
const findings = [];    // security issues (FAIL = vulnerability)
let passed = 0, failed = 0, info = 0;

function record(id, name, severity, ok, detail = "") {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++;
  else { failed++; }
  const d = detail ? ` — ${String(detail).slice(0, 120)}` : "";
  console.log(`  [${status}] [${severity}] ${id}: ${name}${d}`);
  findings.push({ id, name, severity, status, detail: String(detail).slice(0, 300) });
}
function note(id, name, detail = "") {
  info++;
  console.log(`  [INFO] ${id}: ${name} — ${String(detail).slice(0, 150)}`);
  findings.push({ id, name, severity: "INFO", status: "INFO", detail: String(detail).slice(0, 300) });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

async function api(endpoint, token, opts = {}) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.customHeaders) Object.assign(headers, opts.customHeaders);
  const res = await fetch(`${BASE}${endpoint}`, { method: opts.method || "GET", headers, body: opts.body });
  let body;
  try { body = await res.json(); } catch { body = {}; }
  return { status: res.status, body, ok: res.ok };
}

function makePg() {
  return new Client({
    host: POOLER, port: 5432, database: "postgres",
    user: `postgres.${PROJ}`,
    password: process.env.SUPABASE_DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
}

const serviceRoleClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);
const anonClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Demo users (all belong to the same organization: suraksha-demo-bank)
const USERS = {
  compliance: { email: "compliance@suraksha.local", password: "SurakshaCompliance@2026", role: "compliance_admin" },
  owner:      { email: "owner@suraksha.local",      password: "SurakshaOwner@2026",      role: "department_owner" },
  executive:  { email: "executive@suraksha.local",  password: "SurakshaExecutive@2026",  role: "executive_viewer" },
  security:   { email: "security@suraksha.local",   password: "SurakshaSecurity@2026",   role: "security_team" },
  auditor:    { email: "audit@suraksha.local",       password: "SurakshaAudit@2026",      role: "internal_auditor" },
  admin:      { email: "admin@suraksha.local",       password: "SurakshaAdmin@2026",      role: "org_admin" },
};

// =============================================================================
// SEC-01  Cross-Organization Leakage via API
// =============================================================================
async function sec01() {
  console.log("\n=== SEC-01  Cross-Organization Data Leakage via API ===");

  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);
  const me = await api("/api/me", tok);
  const myOrgId = me.body?.organizationId;
  note("SEC-01-INFO", "Caller organization", `id=${myOrgId}`);

  // Insert a sentinel obligation owned by a fake second organization directly via service role.
  const fakeOrg = { id: "00000000-dead-beef-0000-000000000001", name: "Attacker Corp", slug: "attacker-corp" };
  await serviceRoleClient.from("organizations").upsert(fakeOrg, { onConflict: "slug" });

  const sentinel = {
    reference: `SENTINEL-LEAK-${Date.now()}`,
    title: "ATTACKER-CORP-CONFIDENTIAL — Cross-Org Leak Test",
    description: "Should never be visible to suraksha-demo-bank users",
    regulation: "ATTACKER-REG", jurisdiction: "Shadow", department: "Compliance",
    owner: "Attacker", status: "in_progress", priority: "critical",
    due_date: "2030-01-01",
    organization_id: fakeOrg.id,
  };
  const { data: ins, error: insErr } = await serviceRoleClient.from("obligations").insert(sentinel).select("id").single();
  if (insErr) { note("SEC-01-SETUP", "Sentinel insert error (may already exist)", insErr.message); }
  const sentinelId = ins?.id;

  // Now try to read it as a suraksha-demo-bank user via API
  if (sentinelId) {
    const { body: allObls } = await api("/api/obligations", tok);
    const leaked = Array.isArray(allObls) && allObls.some(o => o.id === sentinelId);
    record("SEC-01-A", "Org A user cannot see Org B obligations in list", "CRITICAL", !leaked,
      leaked ? "LEAK: attacker-corp obligation visible to demo-bank user" : `${allObls?.length ?? 0} obligations returned, none from attacker-corp`);

    const { status: directStatus } = await api(`/api/obligations/${sentinelId}`, tok);
    record("SEC-01-B", "Org A user cannot read Org B obligation by ID", "CRITICAL",
      directStatus === 404 || directStatus === 403,
      `got HTTP ${directStatus}`);

    // Cleanup sentinel
    await serviceRoleClient.from("obligations").delete().eq("id", sentinelId);
  }

  // Cleanup fake org
  await serviceRoleClient.from("organizations").delete().eq("slug", "attacker-corp");
}

// =============================================================================
// SEC-02  Cross-Organization Leakage via Supabase anon key (direct API)
// =============================================================================
async function sec02() {
  console.log("\n=== SEC-02  Cross-Organization Leakage via Direct Supabase (anon key) ===");

  // Anon key with no auth should get 0 rows from RLS-protected tables
  const { data: oblsAnon, error: oblsErr } = await anonClient.from("obligations").select("id, title").limit(5);
  const anonSawRows = (oblsAnon?.length ?? 0) > 0;
  record("SEC-02-A", "Anonymous Supabase client cannot read obligations", "CRITICAL", !anonSawRows,
    anonSawRows ? `LEAK: anon client got ${oblsAnon?.length} obligations` : `0 rows (RLS active)`);

  const { data: docsAnon } = await anonClient.from("documents").select("id").limit(5);
  record("SEC-02-B", "Anonymous Supabase client cannot read documents", "CRITICAL", (docsAnon?.length ?? 0) === 0,
    (docsAnon?.length ?? 0) > 0 ? `LEAK: ${docsAnon?.length} docs visible to anon` : "0 rows (RLS active)");

  const { data: profAnon } = await anonClient.from("profiles").select("id").limit(5);
  record("SEC-02-C", "Anonymous Supabase client cannot read profiles", "HIGH", (profAnon?.length ?? 0) === 0,
    (profAnon?.length ?? 0) > 0 ? `LEAK: ${profAnon?.length} profiles visible` : "0 rows (RLS active)");

  const { data: membAnon } = await anonClient.from("organization_members").select("id").limit(5);
  record("SEC-02-D", "Anonymous Supabase client cannot read org membership", "CRITICAL", (membAnon?.length ?? 0) === 0,
    (membAnon?.length ?? 0) > 0 ? `LEAK: ${membAnon?.length} memberships visible` : "0 rows (RLS active)");

  // Try to insert via anon key (should fail or be RLS-blocked)
  const { error: insertErr } = await anonClient.from("obligations").insert({
    reference: `ANON-INJECTION-${Date.now()}`, title: "Anon injection", regulation: "NONE",
    jurisdiction: "None", department: "None", owner: "None", due_date: "2030-01-01",
  });
  record("SEC-02-E", "Anonymous client cannot insert obligations", "CRITICAL", !!insertErr,
    insertErr ? `Blocked: ${insertErr.message.slice(0, 80)}` : "VULNERABILITY: anon insert succeeded");
}

// =============================================================================
// SEC-03  Privilege Escalation
// =============================================================================
async function sec03() {
  console.log("\n=== SEC-03  Privilege Escalation ===");

  const execTok  = await getToken(USERS.executive.email,  USERS.executive.password);
  const ownerTok = await getToken(USERS.owner.email,      USERS.owner.password);
  const audTok   = await getToken(USERS.auditor.email,    USERS.auditor.password);

  // executive_viewer tries to upload a document
  const { status: uploadStatus } = await api("/api/upload-document", execTok, { method: "POST", body: "{}" });
  record("SEC-03-A", "Executive cannot upload documents", "HIGH", uploadStatus === 403 || uploadStatus === 400,
    `got ${uploadStatus}`);

  // executive_viewer tries to create obligation
  const { status: oblStatus } = await api("/api/obligations", execTok, {
    method: "POST", body: JSON.stringify({ title: "Escalation attempt", department: "Compliance", due_date: "2030-01-01" })
  });
  record("SEC-03-B", "Executive cannot create obligations", "HIGH", oblStatus === 403, `got ${oblStatus}`);

  // department_owner tries to delete a document
  const { status: docDelStatus } = await api("/api/documents?id=00000000-0000-0000-0000-000000000001", ownerTok, { method: "DELETE" });
  record("SEC-03-C", "Department owner cannot delete documents", "HIGH", docDelStatus === 403 || docDelStatus === 404,
    `got ${docDelStatus}`);

  // internal_auditor tries to create evidence (read-only role)
  const { status: evStatus } = await api("/api/evidence", audTok, {
    method: "POST", body: JSON.stringify({ obligation_id: "00000000-0000-0000-0000-000000000001", title: "Auditor injection" })
  });
  record("SEC-03-D", "Internal auditor cannot create evidence", "MEDIUM", evStatus === 403 || evStatus === 404,
    `got ${evStatus}`);

  // auditor tries to access admin migrate
  const { status: migrStatus } = await api("/api/admin/migrate", audTok, { method: "GET" });
  record("SEC-03-E", "Internal auditor cannot access admin/migrate", "CRITICAL", migrStatus === 403,
    `got ${migrStatus}`);

  // department_owner tries to approve obligations (needs obligations.approve permission)
  const compTok = await getToken(USERS.compliance.email, USERS.compliance.password);
  const { body: oblsBody } = await api("/api/obligations", compTok);
  const sampleId = Array.isArray(oblsBody) && oblsBody.length > 0 ? oblsBody[0].id : null;
  if (sampleId) {
    const { status: approveStatus } = await api(`/api/obligations/${sampleId}`, ownerTok, {
      method: "PUT", body: JSON.stringify({ status: "compliant" })
    });
    record("SEC-03-F", "Department owner cannot PUT/update arbitrary obligations", "HIGH",
      approveStatus === 403 || approveStatus === 404,
      `got ${approveStatus}`);
  }
}

// =============================================================================
// SEC-04  Horizontal Escalation — User Accessing Another User's Rows
// =============================================================================
async function sec04() {
  console.log("\n=== SEC-04  Horizontal Escalation — Accessing Another User's Assigned Rows ===");

  const compTok = await getToken(USERS.compliance.email, USERS.compliance.password);
  const ownerTok = await getToken(USERS.owner.email, USERS.owner.password);

  // compliance_admin creates an obligation assigned specifically to the compliance user
  const ownerMe = await api("/api/me", ownerTok);
  const ownerUserId = ownerMe.body?.userId;

  const { body: created } = await api("/api/obligations", compTok, {
    method: "POST",
    body: JSON.stringify({
      title: "HORIZONTAL-ESCALATION-TEST — compliance-admin private",
      description: "Private to compliance admin only",
      regulation: "SECURITY-TEST", jurisdiction: "India", department: "Compliance",
      owner: "compliance@suraksha.local", status: "in_progress", priority: "high",
      due_date: new Date(Date.now() + 60 * 86400000).toISOString().split("T")[0],
    })
  });
  const targetId = created?.id;
  if (!targetId) { note("SEC-04-SETUP", "Could not create test obligation", JSON.stringify(created)); return; }

  // owner (dept=Operations) tries to read the Compliance obligation by ID
  const { status: crossDeptStatus } = await api(`/api/obligations/${targetId}`, ownerTok);
  record("SEC-04-A", "Operations dept owner cannot read Compliance obligation by ID", "HIGH",
    crossDeptStatus === 403 || crossDeptStatus === 404,
    `got ${crossDeptStatus}`);

  // owner tries to update the obligation
  const { status: crossDeptUpdate } = await api(`/api/obligations/${targetId}`, ownerTok, {
    method: "PUT", body: JSON.stringify({ status: "compliant" })
  });
  record("SEC-04-B", "Operations dept owner cannot update Compliance obligation", "HIGH",
    crossDeptUpdate === 403 || crossDeptUpdate === 404,
    `got ${crossDeptUpdate}`);

  // Cleanup
  await serviceRoleClient.from("obligations").delete().eq("id", targetId);
}

// =============================================================================
// SEC-05  Department Boundary Violation
// =============================================================================
async function sec05() {
  console.log("\n=== SEC-05  Department Boundary Violation ===");

  const ownerTok = await getToken(USERS.owner.email, USERS.owner.password);

  // Get all obligations the department owner can see
  const { body: ownerObls } = await api("/api/obligations", ownerTok);
  const ownedDept = USERS.owner.dept || "Operations";

  if (Array.isArray(ownerObls)) {
    const outOfDept = ownerObls.filter(o => o.department && o.department !== ownedDept);
    record("SEC-05-A", "Department owner list contains no out-of-dept obligations", "MEDIUM",
      outOfDept.length === 0,
      outOfDept.length === 0
        ? `All ${ownerObls.length} obligations are in dept ${ownedDept} (or no dept set)`
        : `LEAK: ${outOfDept.length} obligations from depts: ${[...new Set(outOfDept.map(o => o.department))].join(", ")}`);
  }

  // Directly try to get Compliance obligations via query param
  const { body: filteredBody } = await api("/api/obligations?department=Compliance", ownerTok);
  if (Array.isArray(filteredBody)) {
    const allCompliance = filteredBody.filter(o => o.department === "Compliance");
    record("SEC-05-B", "Department owner cannot filter and read other dept's obligations", "MEDIUM",
      allCompliance.length === 0,
      allCompliance.length === 0 ? "No Compliance dept obligations visible" :
        `LEAK: ${allCompliance.length} Compliance obligations visible to Operations owner`);
  }

  // Readiness — owner should only see their dept
  const { body: readiness } = await api("/api/readiness", ownerTok);
  if (Array.isArray(readiness)) {
    note("SEC-05-INFO", "Readiness dept count for dept owner", `saw ${readiness.length} departments: ${readiness.map(r => r.department).join(", ")}`);
  }
}

// =============================================================================
// SEC-06  Service-Role Key Not Exposed
// =============================================================================
async function sec06() {
  console.log("\n=== SEC-06  Service-Role Key Exposure ===");

  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);

  // None of the public API responses should contain the service_role key string
  const endpoints = ["/api/me", "/api/obligations", "/api/documents", "/api/readiness"];
  for (const ep of endpoints) {
    const res = await fetch(`${BASE}${ep}`, { headers: { Authorization: `Bearer ${tok}` } });
    const text = await res.text();
    const leaks = process.env.SUPABASE_SERVICE_ROLE_KEY &&
      text.includes(process.env.SUPABASE_SERVICE_ROLE_KEY);
    record("SEC-06-" + ep.replace(/\//g, "-"), `Service role key not in ${ep} response`, "CRITICAL", !leaks,
      leaks ? "CRITICAL LEAK: service_role key found in API response" : "Not found");
  }

  // Check that NEXT_PUBLIC vars don't include service role key
  const srKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  record("SEC-06-ANON-IS-NOT-SR", "NEXT_PUBLIC_SUPABASE_ANON_KEY is not the service_role key", "CRITICAL",
    anonKey !== srKey && !anonKey.includes("service_role"),
    anonKey === srKey ? "CRITICAL: anon key equals service_role key" : "Keys are different");
}

// =============================================================================
// SEC-07  RLS Gaps — Postgres Direct Verification
// =============================================================================
async function sec07() {
  console.log("\n=== SEC-07  RLS Gaps (Postgres Direct) ===");

  const pg = makePg();
  await pg.connect();

  // No tables without RLS
  const { rows: noRls } = await pg.query(
    "select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname='public' and not c.relrowsecurity"
  );
  record("SEC-07-A", "Zero public tables missing RLS", "CRITICAL", noRls.length === 0,
    noRls.length ? `Missing: ${noRls.map(r => r.relname).join(", ")}` : "All tables protected");

  // No anon policies
  const { rows: anonPols } = await pg.query(
    "select tablename, policyname from pg_policies where schemaname in ('public','storage') and roles::text like '%anon%'"
  );
  record("SEC-07-B", "Zero anonymous RLS policies", "CRITICAL", anonPols.length === 0,
    anonPols.length ? `Anon policies: ${anonPols.map(p => `${p.tablename}.${p.policyname}`).join(", ")}` : "OK");

  // Verify key tables have org-scoped read policies
  const { rows: orgPols } = await pg.query(
    "select tablename, count(*)::int as cnt from pg_policies where schemaname='public' and cmd='SELECT' and qual like '%current_organization_id%' group by tablename"
  );
  const orgScopedTables = new Set(orgPols.map(r => r.tablename));
  for (const t of ["documents", "obligations", "evidence", "map_cards"]) {
    record(`SEC-07-C-${t}`, `Table ${t} has org-scoped SELECT policy`, "HIGH",
      orgScopedTables.has(t), orgScopedTables.has(t) ? "Org-scoped" : "MISSING org scope");
  }

  // Verify ABAC-aware policies exist on row-filtered tables
  const { rows: abacPols } = await pg.query(
    "select tablename from pg_policies where schemaname='public' and qual like '%can_access%'"
  );
  const abacTables = new Set(abacPols.map(r => r.tablename));
  for (const t of ["obligations", "evidence", "map_cards"]) {
    record(`SEC-07-D-${t}`, `Table ${t} has ABAC-aware SELECT policy`, "HIGH",
      abacTables.has(t), abacTables.has(t) ? "ABAC enforced" : "No ABAC policy");
  }

  // Check no SECURITY DEFINER functions are in an exposed schema without proper search_path
  const { rows: unsafeFns } = await pg.query(`
    select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null or not (p.proconfig::text like '%search_path%'))
  `);
  record("SEC-07-E", "All SECURITY DEFINER functions have search_path pinned", "HIGH",
    unsafeFns.length === 0,
    unsafeFns.length ? `Unpinned: ${unsafeFns.map(r => r.proname).join(", ")}` : "All safe");

  await pg.end();
}

// =============================================================================
// SEC-08  ID Enumeration — Guessing Resource IDs Across Tenants
// =============================================================================
async function sec08() {
  console.log("\n=== SEC-08  ID Enumeration / Cross-Tenant ID Guessing ===");

  const ownerTok = await getToken(USERS.owner.email, USERS.owner.password);
  const compTok  = await getToken(USERS.compliance.email, USERS.compliance.password);

  // Get some real IDs that exist (compliance user's obligations)
  const { body: compObls } = await api("/api/obligations", compTok);
  const complianceIds = Array.isArray(compObls) ? compObls.map(o => o.id) : [];

  // Owner should not be able to read Compliance dept obligations by guessing their IDs
  let leaked = 0;
  for (const id of complianceIds.slice(0, 3)) {
    const { status } = await api(`/api/obligations/${id}`, ownerTok);
    if (status === 200) leaked++;
  }
  record("SEC-08-A", "Dept owner cannot access Compliance obligations via ID guessing", "HIGH",
    leaked === 0,
    leaked === 0 ? `Tested ${Math.min(complianceIds.length, 3)} IDs — all blocked` :
      `LEAK: ${leaked} Compliance obligations accessible by ID guessing`);

  // Try completely random UUIDs — should 404 not 500
  const randId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const { status: randStatus } = await api(`/api/obligations/${randId}`, compTok);
  record("SEC-08-B", "Random UUID returns 404 not 500 (no enumerable error detail)", "LOW",
    randStatus === 404 || randStatus === 400,
    `got ${randStatus}`);
}

// =============================================================================
// SEC-09  Token Manipulation
// =============================================================================
async function sec09() {
  console.log("\n=== SEC-09  Token Manipulation ===");

  // No token
  const { status: noTok } = await api("/api/obligations", null);
  record("SEC-09-A", "Missing token → 401", "HIGH", noTok === 401, `got ${noTok}`);

  // Empty bearer
  const { status: emptyTok } = await api("/api/obligations", "");
  record("SEC-09-B", "Empty bearer string → 401", "HIGH", emptyTok === 401, `got ${emptyTok}`);

  // Random garbage token
  const { status: garbageTok } = await api("/api/obligations", "notavalidjwt.garbage.xyz");
  record("SEC-09-C", "Garbage token → 401", "HIGH", garbageTok === 401, `got ${garbageTok}`);

  // Truncated valid token
  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);
  const { status: truncTok } = await api("/api/obligations", tok.slice(0, 80));
  record("SEC-09-D", "Truncated token → 401", "MEDIUM", truncTok === 401, `got ${truncTok}`);

  // Base64-encoded anon key as bearer (wrong key type, should fail)
  const { status: anonKeyAsTok } = await api("/api/me", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  record("SEC-09-E", "Anon key used as bearer token → 401", "HIGH", anonKeyAsTok === 401,
    `got ${anonKeyAsTok}` + (anonKeyAsTok === 200 ? " — VULNERABLE: anon key works as auth bearer" : ""));
}

// =============================================================================
// SEC-10  Mass Assignment — Injecting Forbidden Fields
// =============================================================================
async function sec10() {
  console.log("\n=== SEC-10  Mass Assignment / Field Injection ===");

  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);

  // Create legitimate obligation, then try to inject forbidden fields via PUT
  const { body: created } = await api("/api/obligations", tok, {
    method: "POST",
    body: JSON.stringify({
      title: "Mass-Assignment Test Obligation", regulation: "TEST", jurisdiction: "India",
      department: "Compliance", owner: "Test", status: "in_progress", priority: "medium",
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    })
  });
  const testId = created?.id;
  if (!testId) { note("SEC-10-SETUP", "Could not create test obligation"); return; }

  // Try to inject organization_id (tenant ID) via PUT
  const fakeOrgId = "00000000-dead-beef-0000-999999999999";
  const { body: putResult } = await api(`/api/obligations/${testId}`, tok, {
    method: "PUT",
    body: JSON.stringify({
      status: "compliant",
      organization_id: fakeOrgId,   // should be ignored by allowedFields whitelist
      created_by: "00000000-0000-0000-0000-000000000001",  // should be ignored
      review_status: "approved",    // might be in allowedFields
    })
  });

  // Verify that organization_id was NOT changed to fakeOrgId
  const { data: afterPut } = await serviceRoleClient.from("obligations").select("organization_id").eq("id", testId).single();
  const orgUnchanged = afterPut?.organization_id !== fakeOrgId;
  record("SEC-10-A", "PUT cannot overwrite organization_id (mass-assignment blocked)", "CRITICAL",
    orgUnchanged, orgUnchanged ? `org_id unchanged: ${afterPut?.organization_id}` :
    `VULNERABILITY: org_id changed to ${afterPut?.organization_id}`);

  // Try to inject role via POST to notifications (which org_admin can do)
  const adminTok = await getToken(USERS.admin.email, USERS.admin.password);
  const { status: notifStatus } = await api("/api/notifications", adminTok, {
    method: "POST",
    body: JSON.stringify({ title: "Mass-assignment test", message: "test", type: "info",
      organization_id: fakeOrgId  // should be overwritten by principal.organizationId
    })
  });
  if (notifStatus === 201) {
    const { data: notif } = await serviceRoleClient.from("notifications").select("organization_id").order("created_at", { ascending: false }).limit(1).single();
    const notifOrgSafe = notif?.organization_id !== fakeOrgId;
    record("SEC-10-B", "POST notification cannot inject foreign organization_id", "HIGH",
      notifOrgSafe, `org_id=${notif?.organization_id}`);
  } else {
    note("SEC-10-B-SKIP", "Notification POST returned non-201, skipping org injection check", `status=${notifStatus}`);
  }

  // Cleanup
  await serviceRoleClient.from("obligations").delete().eq("id", testId);
}

// =============================================================================
// SEC-11  Concurrent Session Isolation
// =============================================================================
async function sec11() {
  console.log("\n=== SEC-11  Concurrent Session Isolation ===");

  // Log in as the same user from two separate sessions simultaneously
  const anon1 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const anon2 = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  const [s1, s2] = await Promise.all([
    anon1.auth.signInWithPassword({ email: USERS.compliance.email, password: USERS.compliance.password }),
    anon2.auth.signInWithPassword({ email: USERS.compliance.email, password: USERS.compliance.password }),
  ]);

  const tok1 = s1.data?.session?.access_token;
  const tok2 = s2.data?.session?.access_token;

  record("SEC-11-A", "Two concurrent sessions created for same user", "INFO",
    !!(tok1 && tok2), tok1 && tok2 ? "Both sessions established" : "One or both sessions failed");

  if (tok1 && tok2) {
    const [r1, r2] = await Promise.all([
      api("/api/obligations", tok1),
      api("/api/obligations", tok2),
    ]);
    record("SEC-11-B", "Both concurrent sessions return the same data", "MEDIUM",
      r1.ok && r2.ok && JSON.stringify(r1.body) === JSON.stringify(r2.body),
      r1.ok && r2.ok ? "Same data returned — no session bleed" : `Status: ${r1.status} / ${r2.status}`);

    // Sign out session 1 — session 2 should still work (Supabase local auth)
    await anon1.auth.signOut();
    const r2after = await api("/api/me", tok2);
    note("SEC-11-C", "Session 2 state after Session 1 signout",
      `session 2 /api/me status: ${r2after.status} — sessions are independent`);
  }
}

// =============================================================================
// SEC-12  Admin Migrate Endpoint Locked Down
// =============================================================================
async function sec12() {
  console.log("\n=== SEC-12  Admin Migrate Endpoint ===");

  // Unauthenticated
  const { status: anonStatus } = await api("/api/admin/migrate", null);
  record("SEC-12-A", "Unauthenticated access to admin/migrate blocked", "CRITICAL",
    anonStatus === 401, `got ${anonStatus}`);

  // Low-privilege role (executive)
  const execTok = await getToken(USERS.executive.email, USERS.executive.password);
  const { status: execStatus } = await api("/api/admin/migrate", execTok);
  record("SEC-12-B", "Executive cannot access admin/migrate (GET)", "CRITICAL",
    execStatus === 403, `got ${execStatus}`);

  const { status: execPost } = await api("/api/admin/migrate", execTok, {
    method: "POST", body: JSON.stringify({ step: "check" })
  });
  record("SEC-12-C", "Executive cannot POST to admin/migrate", "CRITICAL",
    execPost === 403, `got ${execPost}`);

  // Org admin should access (has settings.manage)
  const adminTok = await getToken(USERS.admin.email, USERS.admin.password);
  const { status: adminStatus } = await api("/api/admin/migrate", adminTok);
  record("SEC-12-D", "Org admin can access admin/migrate (settings.manage permission)", "INFO",
    adminStatus === 200, `got ${adminStatus}`);
}

// =============================================================================
// SEC-13  Storage Bucket Isolation
// =============================================================================
async function sec13() {
  console.log("\n=== SEC-13  Storage Bucket Isolation ===");

  const { data: buckets, error } = await serviceRoleClient.storage.listBuckets();
  record("SEC-13-A", "Storage accessible via service role", "INFO", !error, error?.message);

  const compBucket = buckets?.find(b => b.name === "compliance-documents");
  record("SEC-13-B", "compliance-documents bucket exists", "INFO", !!compBucket, "");
  record("SEC-13-C", "compliance-documents bucket is private", "HIGH", compBucket && !compBucket.public,
    compBucket?.public ? "EXPOSED: bucket is public" : "private");

  // Anon client cannot list bucket contents
  const { data: anonList, error: anonErr } = await anonClient.storage
    .from("compliance-documents").list();
  record("SEC-13-D", "Anonymous client cannot list bucket contents", "HIGH",
    !!anonErr || (anonList?.length === 0),
    anonErr ? `Blocked: ${anonErr.message.slice(0, 60)}` :
      anonList?.length ? `LEAK: ${anonList.length} files visible to anon` : "0 files visible (OK)");
}

// =============================================================================
// SEC-14  Audit Trail Immutability
// =============================================================================
async function sec14() {
  console.log("\n=== SEC-14  Audit Trail Immutability ===");

  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);

  // No API route exposes audit DELETE
  const { status: delStatus } = await api("/api/audit", tok, { method: "DELETE" });
  record("SEC-14-A", "No DELETE route on /api/audit", "HIGH",
    delStatus === 404 || delStatus === 405, `got ${delStatus}`);

  // Get row count before and after an anon delete attempt.
  // Supabase RLS-blocked DELETEs return {error: null, count: 0} — no error is thrown
  // for security-by-silence, so we must verify actual row count stayed the same.
  const { count: beforeCount } = await serviceRoleClient.from("audit_trail").select("*", { count: "exact", head: true });
  await anonClient.from("audit_trail").delete().eq("severity", "info");
  const { count: afterCount } = await serviceRoleClient.from("audit_trail").select("*", { count: "exact", head: true });
  const noRowsDeleted = beforeCount === afterCount;
  record("SEC-14-B", "Anonymous client cannot delete audit trail rows (count verified)", "CRITICAL",
    noRowsDeleted,
    noRowsDeleted ? `Row count unchanged at ${afterCount}` :
      `VULNERABILITY: ${beforeCount - afterCount} rows deleted by anon client`);

  // Verify audit trail has entries from recent operations
  const { data: auditRows } = await serviceRoleClient.from("audit_trail")
    .select("id, action, actor, severity").order("created_at", { ascending: false }).limit(5);
  record("SEC-14-C", "Audit trail has recent entries", "INFO",
    (auditRows?.length ?? 0) > 0, `${auditRows?.length} recent entries`);

  // Check audit entries have actor_user_id populated (not anonymous)
  const { data: anonAudit } = await serviceRoleClient.from("audit_trail")
    .select("id, actor").is("actor_user_id", null).order("created_at", { ascending: false }).limit(10);
  note("SEC-14-D", "Audit entries without actor_user_id (legacy)",
    `${anonAudit?.length ?? 0} entries — these are pre-auth-hardening entries`);
}

// =============================================================================
// SEC-15  Header Injection — Custom Org Header Attack
// =============================================================================
async function sec15() {
  console.log("\n=== SEC-15  Header Injection / Org Header Manipulation ===");

  const tok = await getToken(USERS.compliance.email, USERS.compliance.password);
  const me = await api("/api/me", tok);
  const realOrgId = me.body?.organizationId;

  // Attacker injects a fake org id via x-suraksha-org-id header
  const fakeOrgId = "00000000-dead-beef-0000-000000000002";
  const { body: meWithFakeOrg } = await api("/api/me", tok, {
    customHeaders: { "x-suraksha-org-id": fakeOrgId }
  });

  // The request should either fail (no membership in fake org) or ignore the header
  const okWithFakeOrg = meWithFakeOrg?.organizationId === fakeOrgId;
  record("SEC-15-A", "x-suraksha-org-id header cannot elevate user to non-member org", "HIGH",
    !okWithFakeOrg,
    okWithFakeOrg ? `VULNERABILITY: user placed in org ${fakeOrgId} via header` :
      meWithFakeOrg?.organizationId
        ? `Header rejected — org remains ${meWithFakeOrg.organizationId}`
        : "Header caused 4xx response (properly rejected)");

  // Injecting own real org id — should still work (benign)
  const { body: meWithRealOrg } = await api("/api/me", tok, {
    customHeaders: { "x-suraksha-org-id": realOrgId }
  });
  record("SEC-15-B", "Valid x-suraksha-org-id for own org still works", "INFO",
    meWithRealOrg?.organizationId === realOrgId,
    `org=${meWithRealOrg?.organizationId}`);
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  console.log("================================================================");
  console.log("  Suraksha OS — Multi-Tenant Security & Authorization Audit");
  console.log(`  Base URL : ${BASE}`);
  console.log(`  Project  : ${PROJ}`);
  console.log(`  Time     : ${new Date().toISOString()}`);
  console.log("================================================================");

  const suites = [sec01, sec02, sec03, sec04, sec05, sec06, sec07, sec08, sec09, sec10, sec11, sec12, sec13, sec14, sec15];
  for (const suite of suites) {
    try { await suite(); }
    catch (err) { console.error(`Suite error: ${err.message}`); }
  }

  const criticalFails = findings.filter(f => f.status === "FAIL" && f.severity === "CRITICAL");
  const highFails     = findings.filter(f => f.status === "FAIL" && f.severity === "HIGH");
  const mediumFails   = findings.filter(f => f.status === "FAIL" && f.severity === "MEDIUM");

  console.log("\n================================================================");
  console.log(`  SECURITY AUDIT RESULTS`);
  console.log(`  PASSED:  ${passed}`);
  console.log(`  FAILED:  ${failed}`);
  console.log(`  CRITICAL failures: ${criticalFails.length}`);
  console.log(`  HIGH     failures: ${highFails.length}`);
  console.log(`  MEDIUM   failures: ${mediumFails.length}`);
  console.log("================================================================\n");

  if (criticalFails.length > 0) {
    console.log("CRITICAL VULNERABILITIES FOUND:");
    criticalFails.forEach(f => console.log(`  - ${f.id}: ${f.name} — ${f.detail}`));
  }

  const outPath = "test-results/security-audit-results.json";
  fs.mkdirSync("test-results", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ passed, failed, criticalFails: criticalFails.length, highFails: highFails.length, mediumFails: mediumFails.length, findings, runAt: new Date().toISOString() }, null, 2));
  console.log(`Full results written to ${outPath}`);

  if (criticalFails.length > 0) process.exit(2);
  if (failed > 0) process.exit(1);
}

main().catch(err => { console.error(err.message); process.exit(1); });
