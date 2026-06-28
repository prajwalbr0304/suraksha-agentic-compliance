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
  const now = new Date().toISOString();
  const { data: done } = await svc
    .from("regulatory_changes")
    .select("id,title")
    .eq("organization_id", org)
    .in("lifecycle_status", ["completed", "failed_processing"]);
  let po = 1;
  for (const c of done || []) {
    await svc
      .from("regulatory_changes")
      .update({ lifecycle_status: "queued", status: "detected", processing_started_at: null, queued_at: now, processing_order: po++, queue_position: 0 })
      .eq("id", c.id);
    console.log("requeued:", (c.title || "").slice(0, 50));
  }
  console.log("requeued count:", (done || []).length);
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
