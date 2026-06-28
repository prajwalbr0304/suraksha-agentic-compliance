/**
 * Deletes org-scoped compliance/demo data for ONE bank: documents (DB + storage),
 * obligations, MAP cards, evidence, agent runs, regulatory changes, drift/impact,
 * KPI rows, notifications, audit trail for that org, and graph_relationships edges
 * that reference those entity IDs.
 *
 * Does NOT delete: organizations, members, departments, teams, regulatory_sources,
 * auth users, or founder data.
 *
 * Usage:
 *   node scripts/clear-org-compliance-data.cjs <organization-slug> --yes
 *
 * Example:
 *   node scripts/clear-org-compliance-data.cjs test-cooperative-bank --yes
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

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

async function main() {
  const slug = process.argv[2];
  const confirm = process.argv.includes("--yes");
  if (!slug || slug.startsWith("-")) {
    console.error("Usage: node scripts/clear-org-compliance-data.cjs <organization-slug> --yes");
    process.exit(1);
  }
  if (!confirm) {
    console.error("Refusing to run without --yes (destructive).");
    process.exit(1);
  }

  const org = await must(
    "find organization",
    db.from("organizations").select("id, slug, name").eq("slug", slug).maybeSingle()
  );
  if (!org) {
    console.error(`Organization not found for slug: ${slug}`);
    process.exit(1);
  }
  console.log(`Clearing compliance data for: ${org.name} (${org.slug}) ${org.id}`);

  const summary = await clearOrgComplianceData(db, org.id, BUCKET);
  console.log(`Found documents≈${summary.docCount}; removed ${summary.storageRemoved} storage object(s) from ${BUCKET}`);
  console.log("Done. Refresh the app; Documents / Obligations / Knowledge Graph should be empty for this org.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
