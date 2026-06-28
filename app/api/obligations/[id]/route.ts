/**
 * GET  /api/obligations/[id]   — fetch single obligation
 * PUT  /api/obligations/[id]   — update obligation fields
 * DELETE /api/obligations/[id] — delete obligation
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessRow, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();
  // Support lookup by UUID or reference string
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const baseQuery = supabase.from("obligations").select("*");
  const scopedQuery = baseQuery.eq("organization_id", principal.organizationId!);
  const { data, error } = isUuid
    ? await scopedQuery.eq("id", id).single()
    : await scopedQuery.eq("reference", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  if (!canAccessRow(principal, data as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "obligations.assign");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Only allow updating these fields
  const allowedFields = ["title", "description", "regulation", "jurisdiction", "department", "owner", "status", "priority", "due_date", "tags"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const baseQuery = supabase.from("obligations").update(updates);
  const scopedQuery = baseQuery.eq("organization_id", principal.organizationId!);
  const query = isUuid
    ? scopedQuery.eq("id", id).select().single()
    : scopedQuery.eq("reference", id).select().single();

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!canAccessRow(principal, data as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Log audit
  await writeAudit(supabase, principal, {
    action: "obligation_updated",
    target: String(data.title ?? id),
    targetId: id,
    details: `Updated obligation fields: ${Object.keys(updates).filter(k => k !== "updated_at").join(", ")}`,
    metadata: updates,
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "obligations.assign");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  // Fetch title for audit log
  const isUuidDel = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const existingBaseQuery = supabase.from("obligations").select("id, title");
  const existingScopedQuery = existingBaseQuery.eq("organization_id", principal.organizationId!);
  const { data: existing } = isUuidDel
    ? await existingScopedQuery.eq("id", id).single()
    : await existingScopedQuery.eq("reference", id).single();

  const realId = existing?.id ?? id;

  // Delete linked map_cards and evidence using the real UUID
  await supabase.from("map_cards").delete().eq("obligation_id", realId);
  await supabase.from("evidence").delete().eq("obligation_id", realId);

  const deleteBaseQuery = supabase.from("obligations").delete();
  const deleteScopedQuery = deleteBaseQuery.eq("organization_id", principal.organizationId!);
  const { error } = isUuidDel
    ? await deleteScopedQuery.eq("id", id)
    : await deleteScopedQuery.eq("reference", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log audit
  await writeAudit(supabase, principal, {
    action: "obligation_closed",
    target: existing?.title ?? id,
    targetId: realId,
    details: `Deleted obligation: ${existing?.title ?? id}`,
    severity: "warning",
  });

  return NextResponse.json({ success: true });
}
