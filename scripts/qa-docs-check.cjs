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
// Use service role if available for direct table read; else anon+session.
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || null;
(async () => {
  let sb;
  if (svc) {
    sb = createClient(url, svc, { auth: { persistSession: false } });
  } else {
    sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    await sb.auth.signInWithPassword({ email: "manager@testbank.com", password: "anekal123" });
  }
  const ORG = "e6ef4039-fd0b-49e8-8a56-11d6b10ad1b8";
  const { data, error } = await sb
    .from("regulatory_changes")
    .select("id,lifecycle_status,document_id,manual_pdf_storage_path,pdf_stage,resolved_pdf_url,title,regulator")
    .eq("organization_id", ORG)
    .limit(400);
  if (error) { console.log("ERR", error.message); return; }
  const rows = data || [];
  const withDoc = rows.filter(r => r.document_id);
  const withPdfPath = rows.filter(r => r.manual_pdf_storage_path || r.resolved_pdf_url);
  console.log("total:", rows.length, "| with document_id:", withDoc.length, "| with pdf url/path:", withPdfPath.length);
  console.log("=== changes WITH document_id (first 15) ===");
  for (const r of withDoc.slice(0,15)) {
    console.log(`${r.lifecycle_status} | stage=${r.pdf_stage} | ${r.regulator} | ${(r.title||"").slice(0,60)}`);
  }
  // group with-doc by lifecycle
  const g = {}; for (const r of withDoc) g[r.lifecycle_status]=(g[r.lifecycle_status]||0)+1;
  console.log("with-doc by lifecycle:", JSON.stringify(g));
  // queued items detail
  const queued = rows.filter(r => r.lifecycle_status === "queued");
  console.log("=== queued (first 10): doc? ===");
  for (const r of queued.slice(0,10)) console.log(`doc=${r.document_id?"Y":"n"} stage=${r.pdf_stage} | ${(r.title||"").slice(0,60)}`);
})();
