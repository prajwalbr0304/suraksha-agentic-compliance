/**
 * Manager user administration (scoped to the caller's organization).
 *   GET  — list users (organization_members + profile)
 *   POST — create a user, assign role/department/team
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission, ROLES, type SurakshaRole } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { createOrgUser } from "@/lib/services/user-admin.service";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "users.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization (founders must pass x-suraksha-org-id)" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data: members, error } = await supabase
    .from("organization_members")
    .select("user_id, role, department, team_id, status, created_at")
    .eq("organization_id", principal.organizationId)
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
    status: m.status,
    created_at: m.created_at,
  }));
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "users.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const email = String(body.email ?? "").trim();
  const password = String(body.password ?? "").trim();
  const role = String(body.role ?? "") as SurakshaRole;
  if (!email || !password || !ROLES.includes(role)) {
    return NextResponse.json({ error: "email, password and a valid role are required" }, { status: 400 });
  }
  // Managers cannot mint founders or other managers above their level.
  if (!principal.isFounder && (role === "founder" || role === "platform_admin")) {
    return NextResponse.json({ error: "Cannot assign founder/platform_admin" }, { status: 403 });
  }

  let created;
  try {
    created = await createOrgUser({
      email,
      password,
      fullName: body.full_name ? String(body.full_name) : undefined,
      organizationId: principal.organizationId,
      role,
      department: body.department ? String(body.department) : null,
      teamId: body.team_id ? String(body.team_id) : null,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "createUser failed" }, { status: 500 });
  }

  await writeAudit(supabase(), principal, {
    action: "user_created",
    target: email,
    targetId: created.userId,
    details: `Created user ${email} (${role})`,
    metadata: { role, department: body.department ?? null },
    organizationId: principal.organizationId,
  });

  return NextResponse.json(created, { status: 201 });
}

function supabase() {
  return getSupabaseServerClient();
}
