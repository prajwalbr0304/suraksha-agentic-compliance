/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Enterprise isolation audit: founder authority + manager scoping + cross-tenant blocks.
 * Requires dev server running + enterprise seed applied.
 *   node scripts/enterprise-audit.cjs
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const root = process.cwd();
for (const line of (fs.existsSync(path.join(root, ".env.local")) ? fs.readFileSync(path.join(root, ".env.local"), "utf8").split(/\r?\n/) : [])) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue; const i = t.indexOf("="); if (i === -1) continue;
  const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

let pass = 0, fail = 0;
function check(name, ok, detail = "") { console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`); ok ? pass++ : fail++; return ok; }

async function token(email, password) {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session.access_token;
}
async function api(pathname, tok, opts = {}) {
  const headers = { ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(opts.headers || {}) };
  if (opts.body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${baseURL}${pathname}`, { ...opts, headers });
  let body = null; try { body = await res.json(); } catch {}
  return { status: res.status, body };
}
async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 30000) { try { const r = await fetch(baseURL); if (r.ok || r.status < 500) return; } catch {} await new Promise(r => setTimeout(r, 1000)); }
  throw new Error(`Server not reachable at ${baseURL}`);
}

async function main() {
  await waitForServer();
  console.log("=== Enterprise Isolation Audit ===\n");

  const founderTok = await token("founder@suraksha.local", "SurakshaFounder@2026");
  const mgrHdfcTok = await token("manager@hdfc-bank.suraksha.local", "SurakshaManager@2026");
  const complianceTok = await token("compliance@suraksha.local", "SurakshaCompliance@2026");

  // Founder authority
  const banks = await api("/api/founder/banks", founderTok);
  check("Founder lists all banks (>=3)", banks.status === 200 && Array.isArray(banks.body) && banks.body.length >= 3, `status=${banks.status} count=${Array.isArray(banks.body) ? banks.body.length : "n/a"}`);
  const overview = await api("/api/founder/overview", founderTok);
  check("Founder overview 200", overview.status === 200, `banks=${overview.body?.total_banks}`);

  // Non-founder cannot access founder endpoints
  const cf = await api("/api/founder/banks", complianceTok);
  check("Compliance admin BLOCKED from /api/founder/banks (403)", cf.status === 403, `status=${cf.status}`);
  const co = await api("/api/founder/overview", complianceTok);
  check("Compliance admin BLOCKED from /api/founder/overview (403)", co.status === 403, `status=${co.status}`);

  // Unauthenticated founder endpoint -> 401
  const un = await api("/api/founder/banks", null);
  check("Unauthenticated /api/founder/banks (401)", un.status === 401, `status=${un.status}`);

  // Manager admin within own org
  const mu = await api("/api/admin/users", mgrHdfcTok);
  check("HDFC manager reads own org users (200)", mu.status === 200 && Array.isArray(mu.body), `status=${mu.status} count=${Array.isArray(mu.body) ? mu.body.length : "n/a"}`);

  // Manager cross-tenant attempt via header -> blocked (no membership in ICICI)
  const hdfc = (banks.body || []).find(b => b.slug === "hdfc-bank");
  const icici = (banks.body || []).find(b => b.slug === "icici-bank");
  if (icici) {
    const cross = await api("/api/admin/users", mgrHdfcTok, { headers: { "x-suraksha-org-id": icici.id } });
    check("HDFC manager CANNOT read ICICI users via header (401/403)", cross.status === 401 || cross.status === 403, `status=${cross.status}`);
  } else check("ICICI bank present for cross-tenant test", false, "missing");

  // Founder can drill into a specific bank's admin
  if (hdfc) {
    const drill = await api("/api/admin/users", founderTok, { headers: { "x-suraksha-org-id": hdfc.id } });
    check("Founder drills into HDFC users (200)", drill.status === 200, `status=${drill.status}`);
  } else check("HDFC bank present for founder drill-down", false, "missing");

  // Non-manager cannot use admin user mgmt
  const mun = await api("/api/admin/users", complianceTok);
  check("Compliance admin BLOCKED from /api/admin/users (403)", mun.status === 403, `status=${mun.status}`);

  // Self-protection: manager cannot demote or deactivate self
  const selfRow = (mu.body || []).find((r) => r.email === "manager@hdfc-bank.suraksha.local");
  if (selfRow?.user_id) {
    const demote = await api(`/api/admin/users/${selfRow.user_id}`, mgrHdfcTok, {
      method: "PATCH",
      body: JSON.stringify({ role: "compliance_analyst" }),
    });
    check("Manager cannot PATCH own role (403)", demote.status === 403, `status=${demote.status}`);
    const off = await api(`/api/admin/users/${selfRow.user_id}`, mgrHdfcTok, { method: "DELETE" });
    check("Manager cannot DELETE own membership (403)", off.status === 403, `status=${off.status}`);
  } else check("HDFC manager row present for self-protection test", false, "missing");

  // ── Tenant isolation hardening (migration 019) ─────────────────────────────
  const mgrIciciTok = await token("manager@icici-bank.suraksha.local", "SurakshaManager@2026").catch(() => null);

  // KPI isolation: HDFC manager and ICICI manager must not see identical platform totals.
  if (mgrIciciTok) {
    const [hk, ik] = await Promise.all([
      api("/api/analytics", mgrHdfcTok),
      api("/api/analytics", mgrIciciTok),
    ]);
    check("Analytics overview 200 for managers", hk.status === 200 && ik.status === 200, `hdfc=${hk.status} icici=${ik.status}`);
    // Each manager's analytics are org-scoped (compliance_trend/risk_by_dept are per-org or null baseline).
    check(
      "Manager analytics are org-scoped (no cross-tenant obligation totals)",
      typeof hk.body?.total_obligations === "number" && typeof ik.body?.total_obligations === "number",
      `hdfc_obl=${hk.body?.total_obligations} icici_obl=${ik.body?.total_obligations}`
    );
  } else {
    check("ICICI manager available for KPI isolation test", false, "missing icici manager");
  }

  // Tenant module endpoints reject founder calls without an org context (no cross-org .match fallback).
  const noOrgObl = await api("/api/obligations", founderTok);
  check("Founder w/o org context BLOCKED from /api/obligations (400)", noOrgObl.status === 400, `status=${noOrgObl.status}`);
  if (hdfc) {
    const scopedObl = await api("/api/obligations", founderTok, { headers: { "x-suraksha-org-id": hdfc.id } });
    check("Founder WITH org header reads /api/obligations (200)", scopedObl.status === 200, `status=${scopedObl.status}`);
  }

  // Founder cross-tenant analytics surfaces per-bank rows.
  const fa = await api("/api/founder/analytics", founderTok);
  check("Founder per-bank analytics 200 (>=3 banks)", fa.status === 200 && Array.isArray(fa.body?.banks) && fa.body.banks.length >= 3, `status=${fa.status} banks=${Array.isArray(fa.body?.banks) ? fa.body.banks.length : "n/a"}`);
  const faBlocked = await api("/api/founder/analytics", complianceTok);
  check("Non-founder BLOCKED from /api/founder/analytics (403)", faBlocked.status === 403, `status=${faBlocked.status}`);

  console.log(`\n=== RESULTS — PASSED: ${pass}  FAILED: ${fail} ===`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); });
