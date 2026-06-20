/**
 * Clears compliance artifacts for EVERY organization (keeps orgs, users, departments,
 * teams, regulatory_sources). Destructive: documents + storage, obligations,
 * MAPs, evidence, regulatory_changes, agent runs, drift/impact, KPI rows, etc.
 *
 * Usage:
 *   node scripts/clear-all-orgs-compliance-data.cjs --yes
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const { clearOrgComplianceData } = require("./lib/clear-org-compliance-core.cjs");

const root = process.cwd();
function loadEnv() {
  const p = path.join(root, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET ?? "compliance-documents";

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes (destructive, all orgs).");
    process.exit(1);
  }

  const { data: orgs, error } = await db.from("organizations").select("id, slug, name").order("slug");
  if (error) throw new Error(error.message);
  if (!orgs?.length) {
    console.log("No organizations found.");
    return;
  }

  console.log(`Clearing compliance data for ${orgs.length} organization(s)…`);
  let totalDocs = 0;
  let totalStorage = 0;
  for (const org of orgs) {
    const s = await clearOrgComplianceData(db, org.id, BUCKET);
    totalDocs += s.docCount;
    totalStorage += s.storageRemoved;
    console.log(`  ✓ ${org.slug} (${org.name}) — docs=${s.docCount}, storage_removed=${s.storageRemoved}`);
  }
  console.log(`Done. Totals: documents cleared≈${totalDocs}, storage objects removed=${totalStorage}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
