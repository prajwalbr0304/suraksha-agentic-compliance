/**
 * GET /api/founder/platform-users — all organization members across banks (founder only).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireFounder } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();

  const { data: members, error: mErr } = await supabase
    .from("organization_members")
    .select("user_id, role, organization_id, status, team_id")
    .order("organization_id");
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const { data: orgs, error: oErr } = await supabase.from("organizations").select("id, name, slug, status");
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 });

  const orgMap = new Map((orgs ?? []).map((o) => [o.id, o]));
  const userIds = [...new Set((members ?? []).map((m) => m.user_id).filter(Boolean))] as string[];

  let profileMap = new Map<string, { email: string | null; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profiles, error: pErr } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });
    profileMap = new Map((profiles ?? []).map((p) => [p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null }]));
  }

  const rows = (members ?? []).map((m) => {
    const org = orgMap.get(m.organization_id as string);
    const prof = profileMap.get(m.user_id as string);
    return {
      user_id: m.user_id,
      email: prof?.email ?? "—",
      full_name: prof?.full_name ?? null,
      role: m.role,
      status: m.status,
      team_id: m.team_id,
      organization_id: m.organization_id,
      organization_name: org?.name ?? "—",
      organization_slug: org?.slug ?? "",
      bank_status: org?.status ?? "",
    };
  });

  return NextResponse.json(rows);
}
