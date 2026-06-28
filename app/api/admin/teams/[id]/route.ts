/**
 * Single-team admin (org-scoped).
 *   PATCH  — update name, department_id, lead_user_id
 *   DELETE — remove team if no active members are assigned to it
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

async function loadTeamForOrg(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  teamId: string,
  organizationId: string
) {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name, department_id, lead_user_id, organization_id")
    .eq("id", teamId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { error: error.message as string, row: null };
  if (!data) return { error: "Team not found", row: null };
  return { error: null as string | null, row: data };
}

async function departmentBelongsToOrg(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  departmentId: string,
  organizationId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("departments")
    .select("id")
    .eq("id", departmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !!data;
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "teams.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { error: loadErr, row: existing } = await loadTeamForOrg(supabase, id, principal.organizationId);
  if (loadErr || !existing) {
    return NextResponse.json({ error: loadErr || "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body.department_id !== undefined) {
    if (body.department_id === null || body.department_id === "") {
      patch.department_id = null;
    } else {
      const deptId = String(body.department_id);
      const ok = await departmentBelongsToOrg(supabase, deptId, principal.organizationId);
      if (!ok) {
        return NextResponse.json({ error: "Department not found in this organization." }, { status: 400 });
      }
      patch.department_id = deptId;
    }
  }
  if (body.lead_user_id !== undefined) {
    const lead =
      body.lead_user_id === null || body.lead_user_id === "" ? null : String(body.lead_user_id);
    if (lead) {
      const { data: leadMember } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", principal.organizationId)
        .eq("user_id", lead)
        .eq("status", "active")
        .maybeSingle();
      if (!leadMember) {
        return NextResponse.json(
          { error: "Lead must be an active user in this organization." },
          { status: 400 }
        );
      }
    }
    patch.lead_user_id = lead;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("teams")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", principal.organizationId)
    .select()
    .maybeSingle();

  if (error) {
    const msg = error.message.includes("teams_organization_id_name_key") || error.message.includes("uq_")
      ? "A team with that name already exists in this organization."
      : error.message.includes("unique")
        ? "A team with that name already exists in this organization."
        : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "team_updated",
    target: data.name as string,
    targetId: id,
    details: `Updated team ${String(data.name)}`,
    metadata: patch,
    organizationId: principal.organizationId,
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "teams.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { error: loadErr, row: existing } = await loadTeamForOrg(supabase, id, principal.organizationId);
  if (loadErr || !existing) {
    return NextResponse.json({ error: loadErr || "Not found" }, { status: 404 });
  }

  const teamName = existing.name as string;

  const { count, error: cntErr } = await supabase
    .from("organization_members")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", principal.organizationId)
    .eq("team_id", id)
    .eq("status", "active");

  if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete "${teamName}": ${count} active user(s) are assigned to this team. Reassign them first (Users → edit).`,
      },
      { status: 409 }
    );
  }

  const { error: delErr } = await supabase.from("teams").delete().eq("id", id).eq("organization_id", principal.organizationId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "team_deleted",
    target: teamName,
    targetId: id,
    details: `Deleted team ${teamName}`,
    metadata: { team_name: teamName },
    organizationId: principal.organizationId,
  });

  return NextResponse.json({ ok: true, id });
}
