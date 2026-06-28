/* eslint-disable */
/** Reset watermark + widen lookback for the RBI source so a fresh scan re-detects feed items. */
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
  const { data: srcs } = await svc.from("regulatory_sources").select("id,catalog_slot_id,regulator,feed_url,enabled").eq("organization_id", org);
  for (const s of srcs || []) {
    const isRbiNotif = (s.feed_url || "").toLowerCase().includes("notifications");
    const keep = isRbiNotif;
    const { error } = await svc
      .from("regulatory_sources")
      .update({
        fetch_watermark_published_at: null,
        last_fetch_attempt_at: null,
        last_fetch_success_at: null,
        last_fetch_error: null,
        lookback_days: keep ? 90 : 7,
        enabled: keep,
        approval_required: keep ? true : false,
      })
      .eq("id", s.id);
    console.log(`${keep ? "KEEP" : "off "} ${s.feed_url?.slice(0, 60)} reset=${error ? "ERR " + error.message : "ok"}`);
  }
})().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
