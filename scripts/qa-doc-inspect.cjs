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
  // changes that are queued/processing/completed with a document, recently approved
  const { data: ch } = await sb
    .from("regulatory_changes")
    .select("id,title,lifecycle_status,document_id,approved_at")
    .not("document_id", "is", null)
    .in("lifecycle_status", ["queued", "processing", "completed"])
    .order("approved_at", { ascending: false })
    .limit(6);
  for (const c of ch || []) {
    const { data: doc } = await sb
      .from("documents")
      .select("id,name,size,mime_type,status,storage_path,metadata")
      .eq("id", c.document_id)
      .maybeSingle();
    const { count: chunks } = await sb
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", c.document_id);
    console.log(`\n# ${c.lifecycle_status} | ${(c.title || "").slice(0, 55)}`);
    console.log(`  doc mime=${doc?.mime_type} size=${doc?.size} status=${doc?.status} chunks=${chunks}`);
    console.log(`  storage=${(doc?.storage_path || "").slice(0, 50)} needs_ocr=${doc?.metadata?.needs_ocr} resolvedPdf=${doc?.metadata?.resolved_pdf_url ? "Y" : "n"}`);
    console.log(`  summary=${(doc?.summary || "").slice(0, 80) || "(empty)"}`);
  }
})();
