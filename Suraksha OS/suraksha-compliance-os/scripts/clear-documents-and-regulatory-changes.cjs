/**
 * Deletes ALL rows in regulatory_changes and ALL documents (uploads + agent PDFs),
 * removes matching files from the compliance-documents bucket, and cleans
 * knowledge-graph edges that pointed at those documents / obligations / MAPs
 * that CASCADE-delete with the documents.
 *
 * Does NOT delete: organizations, users, regulatory_sources, agent_runs history,
 * audit_trail, obligations without a document_id, etc.
 *
 * Usage:
 *   node scripts/clear-documents-and-regulatory-changes.cjs --yes
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
 */
const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

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

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes (destructive).");
    process.exit(1);
  }
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: docs, error: docErr } = await db.from("documents").select("id, storage_path");
  if (docErr) throw new Error(docErr.message);
  const docRows = docs ?? [];
  const docIds = docRows.map((d) => String(d.id));
  const storagePaths = docRows.map((d) => d.storage_path).filter(Boolean);

  let oblIds = [];
  if (docIds.length > 0) {
    const { data: linkedObl, error: oblErr } = await db.from("obligations").select("id").in("document_id", docIds);
    if (oblErr) throw new Error(oblErr.message);
    oblIds = (linkedObl ?? []).map((o) => String(o.id));
  }

  let mapIds = [];
  if (oblIds.length > 0) {
    const { data: linkedMaps, error: mapErr } = await db.from("map_cards").select("id").in("obligation_id", oblIds);
    if (mapErr) throw new Error(mapErr.message);
    mapIds = (linkedMaps ?? []).map((m) => String(m.id));
  }

  for (const id of docIds) {
    await db.from("graph_relationships").delete().eq("source_type", "document").eq("source_id", id);
    await db.from("graph_relationships").delete().eq("target_type", "document").eq("target_id", id);
  }
  for (const id of oblIds) {
    await db.from("graph_relationships").delete().eq("source_type", "obligation").eq("source_id", id);
    await db.from("graph_relationships").delete().eq("target_type", "obligation").eq("target_id", id);
  }
  for (const id of mapIds) {
    await db.from("graph_relationships").delete().eq("source_type", "map_card").eq("source_id", id);
    await db.from("graph_relationships").delete().eq("target_type", "map_card").eq("target_id", id);
  }

  const { error: rcErr } = await db.from("regulatory_changes").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (rcErr) throw new Error(rcErr.message);

  const { error: delDocErr } = await db.from("documents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (delDocErr) throw new Error(delDocErr.message);

  let storageRemoved = 0;
  if (storagePaths.length) {
    const { error: stErr } = await db.storage.from(BUCKET).remove(storagePaths);
    if (stErr) console.warn("Storage remove:", stErr.message);
    else storageRemoved = storagePaths.length;
  }

  console.log(
    `Done. regulatory_changes cleared (all orgs), documents removed=${docIds.length}, ` +
      `storage objects removed=${storageRemoved}. ` +
      `Obligations/MAPs tied only to those documents were CASCADE-deleted by Postgres.`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
