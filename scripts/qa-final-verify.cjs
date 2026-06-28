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
  const { data: obls } = await svc.from("obligations").select("title,department,priority,due_date").eq("organization_id", org);
  console.log(`OBLIGATIONS (${(obls || []).length}):`);
  for (const o of obls || []) console.log(`  - [${o.priority}] ${(o.title || "").slice(0, 60)} | dept=${o.department} | due=${o.due_date}`);
  const { data: maps } = await svc.from("map_cards").select("title,department,status,priority,due_date").eq("organization_id", org);
  console.log(`\nMAP CARDS (${(maps || []).length}):`);
  for (const m of maps || []) console.log(`  - [${m.priority}] ${(m.title || "").slice(0, 55)} | dept=${m.department} | status=${m.status}`);
  // lifecycle
  const r = await fetch(BASE + "/api/regulation-center?limit=300", { headers: { Authorization: "Bearer " + data.session.access_token } });
  const cj = await r.json();
  const byLife = {};
  for (const c of cj.changes || []) byLife[c.lifecycle_status] = (byLife[c.lifecycle_status] || 0) + 1;
  console.log("\nLIFECYCLE:", JSON.stringify(byLife));
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
