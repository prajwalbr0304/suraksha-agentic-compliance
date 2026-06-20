/* eslint-disable */
/**
 * DESTRUCTIVE: wipe regulation/obligation/document data for the manager's org only.
 * Scoped to manager@testbank.com's organization_id (resolved via /api/me).
 * Sources (regulatory_sources) are preserved.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
for (const l of fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8").split(/\r?\n/)) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  const k = t.slice(0, i);
  if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
const BASE = "http://localhost:3000";
const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function delEq(table, col, val) {
  try {
    const { error, count } = await svc.from(table).delete({ count: "exact" }).eq(col, val);
    if (error) {
      console.log(`  ${table}: ERROR ${error.message}`);
      return 0;
    }
    console.log(`  ${table}: deleted ${count ?? "?"}`);
    return count ?? 0;
  } catch (e) {
    console.log(`  ${table}: EXC ${e.message}`);
    return 0;
  }
}

async function delByDocIds(table, docIds) {
  if (!docIds.length) {
    console.log(`  ${table}: (no docs) 0`);
    return;
  }
  try {
    const { error, count } = await svc.from(table).delete({ count: "exact" }).in("document_id", docIds);
    console.log(`  ${table}: deleted ${error ? "ERR " + error.message : count}`);
  } catch (e) {
    console.log(`  ${table}: EXC ${e.message}`);
  }
}

(async () => {
  const { data } = await anon.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  if (!data?.session) throw new Error("login failed");
  const me = await (await fetch(BASE + "/api/me", { headers: { Authorization: "Bearer " + data.session.access_token } })).json();
  const org = me.organizationId;
  console.log("manager org:", org, "| email:", me.email);

  // doc ids for this org (for tables keyed only by document_id)
  const { data: docs } = await svc.from("documents").select("id").eq("organization_id", org);
  const docIds = (docs || []).map((d) => d.id);
  console.log("documents in org:", docIds.length);

  console.log("Deleting (FK-safe order):");
  await delEq("escalations", "organization_id", org);
  await delEq("map_cards", "organization_id", org);
  await delEq("obligations", "organization_id", org);
  await delByDocIds("document_chunks", docIds);
  await delEq("regulation_processing_log", "organization_id", org);
  await delEq("drift_comparisons", "organization_id", org);
  await delEq("impact_simulations", "organization_id", org);
  await delEq("regulatory_changes", "organization_id", org);
  await delEq("documents", "organization_id", org);

  // verify
  console.log("Post-cleanup counts:");
  for (const tb of ["documents", "regulatory_changes", "obligations", "map_cards", "document_chunks", "regulation_processing_log", "escalations"]) {
    let q = svc.from(tb).select("id", { count: "exact", head: true });
    if (tb === "document_chunks") {
      // no org column guaranteed; count remaining for our (now-deleted) docs is 0 by definition
      const { count } = await q;
      console.log(`  ${tb}: ${count} (global)`);
    } else {
      const { count } = await q.eq("organization_id", org);
      console.log(`  ${tb}: ${count}`);
    }
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
