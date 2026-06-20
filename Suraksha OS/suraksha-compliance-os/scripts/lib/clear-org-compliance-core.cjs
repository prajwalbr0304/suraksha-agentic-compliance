/**
 * Shared compliance wipe for one organization (service role).
 * Used by clear-org-compliance-data.cjs and clear-all-orgs-compliance-data.cjs.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} db
 * @param {string} orgId
 * @param {string} bucket
 * @returns {Promise<{ slug?: string, name?: string, docCount: number, storageRemoved: number }>}
 */
async function clearOrgComplianceData(db, orgId, bucket) {
  const { data: orgRow } = await db.from("organizations").select("slug, name").eq("id", orgId).maybeSingle();

  const { data: docs } = await db.from("documents").select("id, storage_path").eq("organization_id", orgId);
  const docIds = (docs ?? []).map((d) => d.id);
  const storagePaths = (docs ?? []).map((d) => d.storage_path).filter(Boolean);

  const { data: obls } = await db.from("obligations").select("id").eq("organization_id", orgId);
  const oblIds = (obls ?? []).map((o) => o.id);

  const { data: maps } = await db.from("map_cards").select("id").eq("organization_id", orgId);
  const mapIds = (maps ?? []).map((m) => m.id);

  const { data: evs } = await db.from("evidence").select("id").eq("organization_id", orgId);
  const evIds = (evs ?? []).map((e) => e.id);

  for (const id of docIds) {
    const sid = String(id);
    await db.from("graph_relationships").delete().eq("source_type", "document").eq("source_id", sid);
    await db.from("graph_relationships").delete().eq("target_type", "document").eq("target_id", sid);
  }
  for (const id of oblIds) {
    const sid = String(id);
    await db.from("graph_relationships").delete().eq("source_type", "obligation").eq("source_id", sid);
    await db.from("graph_relationships").delete().eq("target_type", "obligation").eq("target_id", sid);
  }
  for (const id of mapIds) {
    const sid = String(id);
    await db.from("graph_relationships").delete().eq("source_type", "map_card").eq("source_id", sid);
    await db.from("graph_relationships").delete().eq("target_type", "map_card").eq("target_id", sid);
  }
  for (const id of evIds) {
    const sid = String(id);
    await db.from("graph_relationships").delete().eq("source_type", "evidence").eq("source_id", sid);
    await db.from("graph_relationships").delete().eq("target_type", "evidence").eq("target_id", sid);
  }

  await db.from("integration_findings").delete().eq("organization_id", orgId);
  await db.from("agent_runs").delete().eq("organization_id", orgId);
  await db.from("regulatory_changes").delete().eq("organization_id", orgId);
  await db.from("drift_comparisons").delete().eq("organization_id", orgId);
  await db.from("impact_simulations").delete().eq("organization_id", orgId);
  await db.from("audit_exports").delete().eq("organization_id", orgId);
  await db.from("notifications").delete().eq("organization_id", orgId);
  await db.from("audit_trail").delete().eq("organization_id", orgId);
  await db.from("risk_scores").delete().eq("organization_id", orgId);
  await db.from("compliance_trends").delete().eq("organization_id", orgId);
  await db.from("readiness_scores").delete().eq("organization_id", orgId);
  await db.from("obligations").delete().eq("organization_id", orgId);
  await db.from("documents").delete().eq("organization_id", orgId);

  let storageRemoved = 0;
  if (storagePaths.length) {
    const { error: stErr } = await db.storage.from(bucket).remove(storagePaths);
    if (stErr) console.warn(`[${orgRow?.slug ?? orgId}] Storage remove:`, stErr.message);
    else storageRemoved = storagePaths.length;
  }

  return {
    slug: orgRow?.slug,
    name: orgRow?.name,
    docCount: docIds.length,
    storageRemoved,
  };
}

module.exports = { clearOrgComplianceData };
