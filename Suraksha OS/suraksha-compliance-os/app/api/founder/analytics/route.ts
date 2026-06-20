/**
 * GET /api/founder/analytics — per-bank breakdown across all tenants (founder only).
 *
 * Returns one row per organization with the headline numbers a founder monitors:
 * compliance score, open obligations, pending evidence, drift alerts, MAP + user
 * counts. This is the cross-tenant aggregation the founder dashboard renders.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireFounder } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();

  const [{ data: orgs }, { data: obligations }, { data: maps }, { data: evidence }, { data: drift }, { data: members }] =
    await Promise.all([
      supabase.from("organizations").select("id, name, slug, status"),
      supabase.from("obligations").select("organization_id, status"),
      supabase.from("map_cards").select("organization_id, status"),
      supabase.from("evidence").select("organization_id, collected_at"),
      supabase.from("drift_comparisons").select("organization_id"),
      supabase.from("organization_members").select("organization_id"),
    ]);

  const obls = obligations ?? [];
  const mapRows = maps ?? [];
  const evRows = evidence ?? [];
  const driftRows = drift ?? [];
  const memberRows = members ?? [];

  const banks = (orgs ?? []).map((org) => {
    const orgObls = obls.filter((o) => o.organization_id === org.id);
    const compliant = orgObls.filter((o) => o.status === "compliant").length;
    const openObligations = orgObls.filter((o) => o.status !== "compliant").length;
    const pendingEvidence = evRows.filter((e) => e.organization_id === org.id && !e.collected_at).length;
    const driftAlerts = driftRows.filter((d) => d.organization_id === org.id).length;
    const totalMaps = mapRows.filter((m) => m.organization_id === org.id).length;
    const totalUsers = memberRows.filter((m) => m.organization_id === org.id).length;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      compliance_score: orgObls.length > 0 ? Math.round((compliant / orgObls.length) * 100) : 0,
      open_obligations: openObligations,
      pending_evidence: pendingEvidence,
      drift_alerts: driftAlerts,
      total_maps: totalMaps,
      total_users: totalUsers,
    };
  });

  return NextResponse.json({ banks });
}
