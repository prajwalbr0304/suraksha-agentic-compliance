/**
 * PUT    /api/map-cards/[id] — update MAP card (managers full; assignees limited)
 * DELETE /api/map-cards/[id] — soft-archive (status = archived) for compliance history
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  canAccessRow,
  getRequestPrincipal,
  hasPrincipalPermission,
  requireOrgContext,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { MAP_DB_STATUSES } from "@/lib/map-lifecycle";
import { appendMapActivity } from "@/lib/map-activity";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

const PRIORITIES = ["critical", "high", "medium", "low"];
const STATUS_ALLOWLIST = new Set<string>(MAP_DB_STATUSES);
/** Assignee may only drive operational execution statuses (not approval / archive / complete). */
const ASSIGNEE_ALLOWED_STATUSES = new Set(["assigned", "in_progress", "under_review"]);

function summarizeMapPatch(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { eventType: string; summary: string }[] {
  const out: { eventType: string; summary: string }[] = [];
  if (before.status !== after.status) {
    out.push({
      eventType: "status_changed",
      summary: `Status changed from ${String(before.status)} to ${String(after.status)}`,
    });
  }
  if (before.team_id !== after.team_id) {
    out.push({
      eventType: "team_set",
      summary: after.team_id ? "Owning team set on MAP" : "Team cleared from MAP",
    });
  }
  if (before.assigned_to !== after.assigned_to) {
    if (after.assigned_to) {
      out.push({ eventType: "employee_assigned", summary: "Employee assigned to MAP" });
    } else {
      out.push({ eventType: "employee_unassigned", summary: "Assignee removed from MAP" });
    }
  }
  if (before.description !== after.description) {
    out.push({ eventType: "map_updated", summary: "MAP description / notes updated" });
  }
  return out;
}

export async function PUT(req: NextRequest, { params }: Params) {
  let principal;
  try {
    principal = await getRequestPrincipal(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
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

  const { data: existing, error: exErr } = await supabase
    .from("map_cards")
    .select("*")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });
  if (!canAccessRow(principal, existing as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isManager = hasPrincipalPermission(principal, "obligations.assign");

  if (!isManager) {
    if (!hasPrincipalPermission(principal, "documents.read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (existing.assigned_to !== principal.userId) {
      return NextResponse.json(
        { error: "Only the assignee or a manager with obligations.assign can update this MAP" },
        { status: 403 },
      );
    }

    const governanceKeys = [
      "title",
      "owner",
      "due_date",
      "priority",
      "escalated",
      "assigned_to",
      "team_id",
      "department",
      "generated_by",
    ];
    for (const k of governanceKeys) {
      if (body[k] !== undefined) {
        return NextResponse.json({ error: `Field "${k}" cannot be changed by assignee` }, { status: 403 });
      }
    }

    if (body.status !== undefined) {
      const s = String(body.status);
      if (!STATUS_ALLOWLIST.has(s)) {
        return NextResponse.json({ error: `Invalid status: ${s}` }, { status: 400 });
      }
      if (!ASSIGNEE_ALLOWED_STATUSES.has(s)) {
        return NextResponse.json(
          { error: "Assignees may only set status to assigned, in_progress, or under_review" },
          { status: 400 },
        );
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status !== undefined) updates.status = body.status;
    if (body.description !== undefined) updates.description = body.description;

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: "No updatable fields supplied" }, { status: 400 });
    }

    const query = supabase.from("map_cards").update(updates).eq("id", id).eq("organization_id", principal.organizationId!);
    const { data, error } = await query.select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });

    await writeAudit(supabase, principal, {
      action: "map_status_changed",
      target: String(data.title ?? id),
      targetId: id,
      details: "Assignee updated MAP (operational)",
      metadata: updates,
    });

    for (const ev of summarizeMapPatch(existing as Record<string, unknown>, data as Record<string, unknown>)) {
      await appendMapActivity(supabase, {
        organization_id: principal.organizationId!,
        map_card_id: id,
        actor_user_id: principal.userId,
        event_type: ev.eventType,
        summary: ev.summary,
        metadata: updates,
      });
    }

    return NextResponse.json(data);
  }

  // ── Manager path ──────────────────────────────────────────────────────────
  if (body.status !== undefined && !STATUS_ALLOWLIST.has(String(body.status))) {
    return NextResponse.json({ error: `Invalid status. Allowed: ${[...STATUS_ALLOWLIST].join(", ")}` }, { status: 400 });
  }
  if (body.priority !== undefined && !PRIORITIES.includes(String(body.priority))) {
    return NextResponse.json({ error: `Invalid priority. Allowed: ${PRIORITIES.join(", ")}` }, { status: 400 });
  }

  const allowed = [
    "title",
    "owner",
    "due_date",
    "status",
    "priority",
    "description",
    "escalated",
    "assigned_to",
    "team_id",
    "department",
    "generated_by",
  ];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowed) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const query = supabase.from("map_cards").update(updates).eq("id", id).eq("organization_id", principal.organizationId!);
  const { data, error } = await query.select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });
  if (!canAccessRow(principal, data as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await writeAudit(supabase, principal, {
    action: "map_status_changed",
    target: String(data.title ?? id),
    targetId: id,
    details: `Updated MAP card: ${Object.keys(updates)
      .filter((k) => k !== "updated_at")
      .join(", ")}`,
    metadata: updates,
  });

  for (const ev of summarizeMapPatch(existing as Record<string, unknown>, data as Record<string, unknown>)) {
    await appendMapActivity(supabase, {
      organization_id: principal.organizationId!,
      map_card_id: id,
      actor_user_id: principal.userId,
      event_type: ev.eventType,
      summary: ev.summary,
      metadata: updates,
    });
  }

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  let principal;
  try {
    principal = await getRequestPrincipal(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
  if (!hasPrincipalPermission(principal, "obligations.assign")) {
    return NextResponse.json({ error: "Forbidden", permission: "obligations.assign" }, { status: 403 });
  }
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { data: existing, error: exErr } = await supabase
    .from("map_cards")
    .select("id, title, organization_id, status")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });
  if (!canAccessRow(principal, existing as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("map_cards")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "MAP card not found" }, { status: 404 });

  await writeAudit(supabase, principal, {
    action: "obligation_closed",
    target: String(existing.title ?? id),
    targetId: id,
    details: `Archived MAP card (soft delete): ${existing.title ?? id}`,
    severity: "warning",
  });

  await appendMapActivity(supabase, {
    organization_id: principal.organizationId!,
    map_card_id: id,
    actor_user_id: principal.userId,
    event_type: "archived",
    summary: "MAP archived (retained for audit history)",
    metadata: { previous_status: existing.status },
  });

  return NextResponse.json({ success: true, archived: true, data });
}
