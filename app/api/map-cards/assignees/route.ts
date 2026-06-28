/**
 * GET /api/map-cards/assignees — org members for MAP assignment (managers with obligations.assign).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.assign");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  const orgId = principal.organizationId!;

  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id, role, department, team_id")
    .eq("organization_id", orgId)
    .eq("status", "active")
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = Array.from(new Set((members ?? []).map((m) => m.user_id)));
  const profileMap = new Map<string, { email: string | null; full_name: string | null }>();
  if (ids.length > 0) {
    const { data: profiles } = await supabase.from("profiles").select("id, email, full_name").in("id", ids);
    for (const p of profiles ?? []) profileMap.set(p.id, { email: p.email, full_name: p.full_name });
  }

  const users = (members ?? []).map((m) => ({
    user_id: m.user_id,
    email: profileMap.get(m.user_id)?.email ?? null,
    full_name: profileMap.get(m.user_id)?.full_name ?? null,
    role: m.role,
    department: m.department,
    team_id: m.team_id,
  }));

  return NextResponse.json(users);
}
