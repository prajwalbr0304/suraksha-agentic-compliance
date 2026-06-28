/**
 * GET /api/map-cards/my-tasks — MAPs assigned to the current user (operational queue).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { filterAccessibleRows, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const TERMINAL = new Set(["completed", "rejected", "archived"]);

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;
  if (!principal.userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("map_cards")
    .select(
      "id, title, status, priority, due_date, obligation_id, team_id, assigned_to, obligations(title)",
    )
    .eq("organization_id", principal.organizationId!)
    .eq("assigned_to", principal.userId)
    .order("due_date", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).filter((r) => !TERMINAL.has(String((r as { status?: string }).status ?? "")));
  return NextResponse.json(filterAccessibleRows(principal, rows as Record<string, unknown>[]));
}
