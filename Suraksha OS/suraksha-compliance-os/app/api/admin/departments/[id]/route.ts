/**
 * Single-department admin (org-scoped).
 *   PATCH  — update name, head, email, risk_level
 *   DELETE — remove department if no active members are assigned to it
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

interface Params {
  params: Promise<{ id: string }>;
}

async function loadDepartmentForOrg(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  departmentId: string,
  organizationId: string
) {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name, head, email, risk_level, organization_id")
    .eq("id", departmentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) return { error: error.message as string, row: null };
  if (!data) return { error: "Department not found", row: null };
  return { error: null as string | null, row: data };
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "departments.manage");
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

  const { error: loadErr, row: existing } = await loadDepartmentForOrg(supabase, id, principal.organizationId);
  if (loadErr || !existing) {
    return NextResponse.json({ error: loadErr || "Not found" }, { status: 404 });
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body.head !== undefined) patch.head = body.head === null ? null : String(body.head).trim() || null;
  if (body.email !== undefined) patch.email = body.email === null ? null : String(body.email).trim() || null;
  if (typeof body.risk_level === "string" && ["low", "medium", "high"].includes(body.risk_level)) {
    patch.risk_level = body.risk_level;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("departments")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", principal.organizationId)
    .select()
    .maybeSingle();

  if (error) {
    const msg = error.message.includes("uq_departments_org_name")
      ? "A department with that name already exists in this organization."
      : error.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  if (!data) return NextResponse.json({ error: "Update failed" }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "department_updated",
    target: data.name as string,
    targetId: id,
    details: `Updated department ${String(data.name)}`,
    metadata: patch,
    organizationId: principal.organizationId,
  });

  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const principal = await requirePermission(req, "departments.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) {
    return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const { id } = await params;
  const supabase = getSupabaseServerClient();

  const { error: loadErr, row: existing } = await loadDepartmentForOrg(supabase, id, principal.organizationId);
  if (loadErr || !existing) {
    return NextResponse.json({ error: loadErr || "Not found" }, { status: 404 });
  }

  const deptName = existing.name as string;

  const { count, error: cntErr } = await supabase
    .from("organization_members")
    .select("*", { count: "exact", head: true })
    .eq("organization_id", principal.organizationId)
    .eq("department", deptName)
    .eq("status", "active");

  if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
  if ((count ?? 0) > 0) {
    return NextResponse.json(
      {
        error:
          `Cannot delete "${deptName}": ${count} active user(s) are assigned to this department. Reassign them first (Users → edit).`,
      },
      { status: 409 }
    );
  }

  const { error: delErr } = await supabase
    .from("departments")
    .delete()
    .eq("id", id)
    .eq("organization_id", principal.organizationId);

  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "department_deleted",
    target: deptName,
    targetId: id,
    details: `Deleted department ${deptName}`,
    metadata: { department_name: deptName },
    organizationId: principal.organizationId,
  });

  return NextResponse.json({ ok: true, id });
}
