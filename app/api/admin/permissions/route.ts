/**
 * Manager per-user permission grants (org-scoped).
 *   GET    ?user_id= — list grants for a user (or all in org)
 *   POST   — grant a permission to a user
 *   DELETE ?user_id=&permission= — revoke a grant
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { isFounderAccountId } from "@/lib/auth/founder-account";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "permissions.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json([], { status: 200 });

  const supabase = getSupabaseServerClient();
  let q = supabase.from("user_permissions").select("user_id, permission, granted_by, created_at").eq("organization_id", principal.organizationId);
  const userId = req.nextUrl.searchParams.get("user_id");
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "permissions.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const userId = String(body.user_id ?? "");
  const permission = String(body.permission ?? "").trim();
  if (!userId || !permission) return NextResponse.json({ error: "user_id and permission are required" }, { status: 400 });

  if (permission === "admin.all" && !principal.isFounder) {
    return NextResponse.json({ error: "Only a platform founder may grant admin.all" }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();
  if (!principal.isFounder && (await isFounderAccountId(supabase, userId))) {
    return NextResponse.json({ error: "Cannot grant permissions to a platform founder account" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("user_permissions")
    .upsert({
      user_id: userId,
      organization_id: principal.organizationId,
      permission,
      ...(principal.userId && { granted_by: principal.userId }),
    }, { onConflict: "user_id,organization_id,permission" })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "permission_changed",
    target: userId,
    targetId: userId,
    details: `Granted permission ${permission} to ${userId}`,
    metadata: { permission, granted: true },
  });
  return NextResponse.json(data, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const principal = await requirePermission(req, "permissions.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

  const userId = req.nextUrl.searchParams.get("user_id");
  const permission = req.nextUrl.searchParams.get("permission");
  if (!userId || !permission) return NextResponse.json({ error: "user_id and permission query params required" }, { status: 400 });

  if (permission === "admin.all" && !principal.isFounder) {
    return NextResponse.json({ error: "Only a platform founder may revoke admin.all" }, { status: 403 });
  }

  const supabase = getSupabaseServerClient();
  if (!principal.isFounder && (await isFounderAccountId(supabase, userId))) {
    return NextResponse.json({ error: "Cannot revoke permissions from a platform founder account" }, { status: 403 });
  }

  const { error } = await supabase
    .from("user_permissions")
    .delete()
    .eq("organization_id", principal.organizationId)
    .eq("user_id", userId)
    .eq("permission", permission);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "permission_changed",
    target: userId,
    targetId: userId,
    details: `Revoked permission ${permission} from ${userId}`,
    metadata: { permission, granted: false },
  });
  return NextResponse.json({ success: true });
}
