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
const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const runId = process.argv[2];
  let q = svc.from("agent_events").select("type,message,payload,created_at").order("created_at", { ascending: true }).limit(80);
  if (runId) q = q.eq("run_id", runId);
  const { data, error } = await q;
  if (error) { console.log("query error:", error.message); return; }
  for (const e of data || []) {
    let extra = "";
    if (e.payload && Object.keys(e.payload).length) extra = " :: " + JSON.stringify(e.payload).slice(0, 200);
    console.log(`${(e.created_at || "").slice(11, 19)} [${e.type}] ${(e.message || "").slice(0, 110)}${extra}`);
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
