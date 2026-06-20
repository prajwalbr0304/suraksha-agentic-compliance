/* eslint-disable */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const envPath = path.join(__dirname, "..", ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const t = line.trim(); if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("="); if (i === -1) continue;
  const k = t.slice(0, i); if (!process.env[k]) process.env[k] = t.slice(i + 1);
}
const BASE = "http://localhost:3000";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
(async () => {
  const { data } = await sb.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  const token = data.session.access_token;
  const H = { Authorization: "Bearer " + token };
  let r = await fetch(BASE + "/api/regulatory-sources", { headers: H });
  const sj = await r.json();
  console.log("=== SOURCES ===");
  for (const s of sj.sources || []) {
    console.log(`${s.enabled ? "ON " : "off"} | sid=${s.sourceId ? s.sourceId.slice(0,8) : "------"} | ${s.catalogId} | ${s.displayLabel || s.label} | ${s.sourceType}`);
  }
  r = await fetch(BASE + "/api/regulation-center?limit=300", { headers: H });
  const cj = await r.json();
  const byLife = {};
  for (const c of cj.changes || []) byLife[c.lifecycle_status] = (byLife[c.lifecycle_status] || 0) + 1;
  console.log("=== CHANGES by lifecycle ===");
  console.log(JSON.stringify(byLife, null, 0));
  console.log("total changes:", (cj.changes || []).length);
  // show a few 'new' candidates
  const news = (cj.changes || []).filter(c => ["new","awaiting_approval","failed_ingest"].includes(c.lifecycle_status)).slice(0, 8);
  console.log("=== NEW-tab candidates (first 8) ===");
  for (const c of news) console.log(`${c.lifecycle_status} | doc=${c.document_id ? "Y":"n"} | ${(c.title||"").slice(0,70)}`);
})();
