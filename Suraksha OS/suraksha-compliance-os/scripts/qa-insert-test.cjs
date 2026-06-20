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
  const { data: doc } = await svc.from("documents").select("id").eq("organization_id", org).limit(1);
  const docId = doc?.[0]?.id || null;
  const row = {
    reference: "AGENT-TEST-" + Date.now(),
    title: "Test obligation insert",
    description: "probe",
    regulation: "Regulatory Circular",
    jurisdiction: "India",
    department: "Compliance",
    owner: "AI Agent",
    status: "in_progress",
    priority: "medium",
    due_date: null,
    confidence_score: 80,
    citation: "x",
    compliance_risk: "medium",
    document_id: docId,
    organization_id: org,
    review_status: "pending",
    source: "agent",
    obligation_fingerprint: "testfp" + Date.now(),
  };
  const { data: ins, error } = await svc.from("obligations").insert(row).select("id").single();
  if (error) {
    console.log("INSERT ERROR:", error.message, "| code:", error.code, "| details:", error.details, "| hint:", error.hint);
  } else {
    console.log("INSERT OK id:", ins.id);
    await svc.from("obligations").delete().eq("id", ins.id);
    console.log("cleaned up test row");
  }
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
