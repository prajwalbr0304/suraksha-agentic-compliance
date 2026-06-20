/* eslint-disable */
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
(async () => {
  const { data } = await anon.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  const me = await (await fetch(BASE + "/api/me", { headers: { Authorization: "Bearer " + data.session.access_token } })).json();
  const org = me.organizationId;
  console.log("org:", org);
  const { count: oblCount } = await svc.from("obligations").select("id", { count: "exact", head: true }).eq("organization_id", org);
  const { count: mapCount } = await svc.from("map_cards").select("id", { count: "exact", head: true }).eq("organization_id", org);
  console.log(`obligations=${oblCount} map_cards=${mapCount}`);

  const { data: ch } = await svc
    .from("regulatory_changes")
    .select("id,title,lifecycle_status,document_id,ingestion_error")
    .eq("organization_id", org)
    .in("lifecycle_status", ["completed", "failed_processing", "processing", "queued"])
    .order("approved_at", { ascending: false });
  for (const c of ch || []) {
    const { count: obl } = await svc.from("obligations").select("id", { count: "exact", head: true }).eq("document_id", c.document_id);
    console.log(`\n${c.lifecycle_status} | obl(doc)=${obl} | ${(c.title || "").slice(0, 55)}`);
    if (c.ingestion_error) console.log(`  err: ${(c.ingestion_error || "").slice(0, 140)}`);
  }
  // recent extract logs for this org
  const { data: logs } = await svc
    .from("regulation_processing_log")
    .select("stage,status,message,started_at")
    .eq("organization_id", org)
    .eq("stage", "extract")
    .order("started_at", { ascending: false })
    .limit(8);
  console.log("\n--- org extract logs ---");
  for (const l of logs || []) console.log(`${(l.started_at || "").slice(11, 19)} [${l.status}] ${(l.message || "").slice(0, 70)}`);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
