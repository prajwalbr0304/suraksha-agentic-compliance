/**
 * GET /api/map-cards/[id]/activity — MAP audit timeline (documents.read).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessRow, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: card, error: cErr } = await supabase
    .from("map_cards")
    .select("id, organization_id, department, assigned_to")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (!card) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });
  if (!canAccessRow(principal, card as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("map_activity")
    .select("id, event_type, summary, metadata, actor_user_id, created_at")
    .eq("map_card_id", id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
