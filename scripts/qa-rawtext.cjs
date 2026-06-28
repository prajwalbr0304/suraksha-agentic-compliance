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
  const { data: rows } = await svc
    .from("regulatory_changes")
    .select("id,title,lifecycle_status,document_id,raw_text")
    .eq("organization_id", org)
    .in("lifecycle_status", ["awaiting_approval", "new", "queued"])
    .order("created_at", { ascending: false })
    .limit(12);
  for (const r of rows || []) {
    console.log(`${r.lifecycle_status} | doc=${r.document_id ? r.document_id.slice(0, 8) : "----"} | rawlen=${(r.raw_text || "").length} | ${(r.title || "").slice(0, 55)}`);
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
