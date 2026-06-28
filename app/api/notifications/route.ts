import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (principal.organizationId) query = query.eq("organization_id", principal.organizationId);
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json(data ?? []);
  } catch (err) {
    console.error("[notifications GET]", err);
    return NextResponse.json([], { status: 500 });
  }
}

// PATCH — mark notification(s) as read
export async function PATCH(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  try {
    const { id, all } = await req.json();
    const supabase = getSupabaseServerClient();
    if (all) {
      let query = supabase.from("notifications").update({ read: true }).eq("read", false);
      if (principal.organizationId) query = query.eq("organization_id", principal.organizationId);
      const { error } = await query;
      if (error) throw error;
    } else if (id) {
      let query = supabase.from("notifications").update({ read: true }).eq("id", id);
      if (principal.organizationId) query = query.eq("organization_id", principal.organizationId);
      const { error } = await query;
      if (error) throw error;
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notifications PATCH]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// POST — create notification
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "settings.manage");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const body = await req.json();
    if (!body.title) return NextResponse.json({ error: "title is required" }, { status: 400 });
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("notifications")
      .insert({
        title: String(body.title).slice(0, 500),
        message: body.message ? String(body.message).slice(0, 2000) : null,
        type: ["info", "warning", "error", "success", "escalation"].includes(body.type) ? body.type : "info",
        target_type: body.target_type ?? null,
        target_id: body.target_id ?? null,
        organization_id: principal.organizationId,
      })
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Notification creation failed" }, { status: 500 });
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    console.error("[notifications POST]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
