/**
 * GET /api/founder/overview — cross-tenant platform metrics (founder only).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireFounder } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();

  const [{ data: orgs }, { count: memberCount }, { count: founderCount }, { data: obligations }, { count: mapCount }] = await Promise.all([
    supabase.from("organizations").select("id, name, slug, status"),
    supabase.from("organization_members").select("id", { count: "exact", head: true }),
    supabase.from("founders").select("id", { count: "exact", head: true }),
    supabase.from("obligations").select("status"),
    supabase.from("map_cards").select("id", { count: "exact", head: true }),
  ]);

  const orgList = orgs ?? [];
  const obls = obligations ?? [];
  const compliant = obls.filter((o) => o.status === "compliant").length;
  const complianceScore = obls.length > 0 ? Math.round((compliant / obls.length) * 100) : 0;

  return NextResponse.json({
    total_banks: orgList.length,
    active_banks: orgList.filter((o) => o.status === "active").length,
    suspended_banks: orgList.filter((o) => o.status === "suspended").length,
    total_users: memberCount ?? 0,
    total_founders: founderCount ?? 0,
    total_obligations: obls.length,
    total_maps: mapCount ?? 0,
    platform_compliance_score: complianceScore,
  });
}
