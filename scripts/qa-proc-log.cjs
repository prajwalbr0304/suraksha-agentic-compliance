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
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await sb
    .from("regulation_processing_log")
    .select("stage,status,message,started_at,ended_at")
    .order("started_at", { ascending: false })
    .limit(14);
  for (const r of data || []) {
    const ts = (r.started_at || "").slice(11, 19);
    const done = r.ended_at ? "done" : "... ";
    console.log(`${ts} ${done} [${r.stage}/${r.status}] ${(r.message || "").slice(0, 75)}`);
  }
  // also recent agent_events for process pipeline
  const { data: ev } = await sb
    .from("agent_events")
    .select("type,message,created_at")
    .order("created_at", { ascending: false })
    .limit(8);
  console.log("--- recent agent_events ---");
  for (const e of ev || []) console.log(`${(e.created_at || "").slice(11, 19)} [${e.type}] ${(e.message || "").slice(0, 70)}`);
})();
