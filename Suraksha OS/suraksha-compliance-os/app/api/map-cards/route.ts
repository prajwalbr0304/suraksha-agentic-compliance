/**
 * GET  /api/map-cards — list all MAP cards
 * POST /api/map-cards — create a new MAP card
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { filterAccessibleRows, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { MAP_DB_STATUSES } from "@/lib/map-lifecycle";
import { appendMapActivity } from "@/lib/map-activity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  const oblId = req.nextUrl.searchParams.get("obligation_id");
  const status = req.nextUrl.searchParams.get("status");
  let query = supabase.from("map_cards").select("*").order("created_at", { ascending: false });
  query = query.eq("organization_id", principal.organizationId!);
  if (oblId) query = query.eq("obligation_id", oblId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(filterAccessibleRows(principal, data ?? []));
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, obligation_id, owner, due_date, priority } = body;
  if (!title) return NextResponse.json({ error: "title is required" }, { status: 400 });
  if (!obligation_id) return NextResponse.json({ error: "obligation_id is required" }, { status: 400 });

  // Verify obligation belongs to caller's org (IDOR fix)
  if (principal.organizationId) {
    const { data: oblCheck } = await supabase.from("obligations").select("id").eq("id", String(obligation_id)).eq("organization_id", principal.organizationId).maybeSingle();
    if (!oblCheck) return NextResponse.json({ error: "Obligation not found in your organization" }, { status: 403 });
  }

  const requested = body.status != null ? String(body.status) : "approved";
  if (!MAP_DB_STATUSES.includes(requested as (typeof MAP_DB_STATUSES)[number])) {
    return NextResponse.json({ error: `Invalid status: ${requested}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("map_cards")
    .insert({
      title: String(title),
      obligation_id: String(obligation_id),
      owner: String(owner ?? "Compliance Team"),
      due_date: (due_date as string) ?? new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      status: requested,
      priority: (priority as string) ?? "medium",
      escalated: false,
      generated_by: "manual",
      ...(principal.organizationId && { organization_id: principal.organizationId }),
      department: body.department ? String(body.department) : principal.department,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Audit
  await writeAudit(supabase, principal, {
    action: "map_created",
    target: String(title),
    targetId: data.id,
    details: `Created MAP card: ${title}`,
    metadata: { obligation_id, owner, priority },
  });

  if (principal.organizationId) {
    await appendMapActivity(supabase, {
      organization_id: principal.organizationId,
      map_card_id: data.id,
      actor_user_id: principal.userId,
      event_type: "map_created",
      summary: `MAP created: ${String(title).slice(0, 80)}`,
      metadata: { obligation_id, status: requested },
    });
  }

  return NextResponse.json(data, { status: 201 });
}
