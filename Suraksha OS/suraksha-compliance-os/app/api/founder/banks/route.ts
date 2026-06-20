/**
 * Founder bank (organization) management.
 *   GET    — list all banks with per-tenant stats
 *   POST   — create a new bank + its first Bank Manager (+ default departments)
 *   PATCH  — suspend / activate / archive a bank **or** update bank manager credentials
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireFounder } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { createOrgUser, updateBankManagerCredentials } from "@/lib/services/user-admin.service";

export const runtime = "nodejs";

const DEFAULT_DEPARTMENTS = [
  { name: "Compliance", risk_level: "high" },
  { name: "Risk Management", risk_level: "high" },
  { name: "IT", risk_level: "medium" },
  { name: "Security", risk_level: "high" },
  { name: "Operations", risk_level: "medium" },
  { name: "Internal Audit", risk_level: "high" },
  { name: "Finance", risk_level: "low" },
  { name: "Legal", risk_level: "medium" },
];

function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function GET(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;
  const supabase = getSupabaseServerClient();

  const { data: orgs, error } = await supabase
    .from("organizations")
    .select("id, name, slug, status, region, license_no, manager_email, created_at")
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Per-bank aggregates
  const [{ data: members }, { data: depts }, { data: obligations }] = await Promise.all([
    supabase.from("organization_members").select("organization_id, role"),
    supabase.from("departments").select("organization_id"),
    supabase.from("obligations").select("organization_id, status"),
  ]);

  const banks = (orgs ?? []).map((o) => {
    const orgMembers = (members ?? []).filter((m) => m.organization_id === o.id);
    const orgObls = (obligations ?? []).filter((ob) => ob.organization_id === o.id);
    const compliant = orgObls.filter((ob) => ob.status === "compliant").length;
    return {
      ...o,
      users: orgMembers.length,
      managers: orgMembers.filter((m) => m.role === "bank_manager").length,
      departments: (depts ?? []).filter((d) => d.organization_id === o.id).length,
      obligations: orgObls.length,
      compliance_score: orgObls.length > 0 ? Math.round((compliant / orgObls.length) * 100) : 0,
    };
  });

  return NextResponse.json(banks);
}

export async function POST(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;
  const supabase = getSupabaseServerClient();

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const name = String(body.name ?? "").trim();
  const managerEmail = String(body.manager_email ?? "").trim();
  const managerPassword = String(body.manager_password ?? "").trim();
  if (!name || !managerEmail || !managerPassword) {
    return NextResponse.json({ error: "name, manager_email and manager_password are required" }, { status: 400 });
  }

  const slug = String(body.slug ?? slugify(name)) || slugify(name);

  // 1. Create organization
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({
      name,
      slug,
      status: "active",
      region: body.region ? String(body.region) : null,
      license_no: body.license_no ? String(body.license_no) : null,
      manager_email: managerEmail,
      ...(principal.userId && { created_by: principal.userId }),
    })
    .select()
    .single();
  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 500 });

  // 2. Default departments
  await supabase.from("departments").insert(
    DEFAULT_DEPARTMENTS.map((d) => ({ ...d, organization_id: org.id }))
  );

  // 3. First Bank Manager
  let manager: { userId: string; email: string } | null = null;
  try {
    manager = await createOrgUser({
      email: managerEmail,
      password: managerPassword,
      fullName: body.manager_full_name ? String(body.manager_full_name) : "Bank Manager",
      organizationId: org.id,
      role: "bank_manager",
    });
  } catch (e) {
    return NextResponse.json({ error: `Bank created but manager failed: ${e instanceof Error ? e.message : e}`, organization: org }, { status: 207 });
  }

  await writeAudit(supabase, principal, {
    action: "bank_created",
    target: name,
    targetId: org.id,
    details: `Founder created bank ${name} with manager ${managerEmail}`,
    metadata: { slug, manager_email: managerEmail },
    organizationId: org.id,
  });

  return NextResponse.json({ organization: org, manager }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const principal = await requireFounder(req);
  if (isAuthResponse(principal)) return principal;
  const supabase = getSupabaseServerClient();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orgId = String(body.organization_id ?? "").trim();
  if (!orgId) {
    return NextResponse.json({ error: "organization_id is required" }, { status: 400 });
  }

  const wantsEmail = typeof body.manager_email === "string" && body.manager_email.trim().length > 0;
  const wantsPassword = typeof body.manager_password === "string" && body.manager_password.trim().length > 0;
  const wantsName = Object.prototype.hasOwnProperty.call(body, "manager_full_name");

  let managerResult: { userId: string; email: string } | null = null;
  if (wantsEmail || wantsPassword || wantsName) {
    try {
      managerResult = await updateBankManagerCredentials({
        organizationId: orgId,
        email: wantsEmail ? String(body.manager_email).trim() : undefined,
        password: wantsPassword ? String(body.manager_password).trim() : undefined,
        ...(wantsName
          ? { fullName: body.manager_full_name == null ? "" : String(body.manager_full_name) }
          : {}),
      });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Manager update failed" },
        { status: 400 }
      );
    }
    await writeAudit(supabase, principal, {
      action: "user_updated",
      target: managerResult.email,
      targetId: managerResult.userId,
      details: "Founder updated bank manager login or profile",
      metadata: {
        organization_id: orgId,
        changed_email: wantsEmail,
        changed_password: wantsPassword,
        changed_name: wantsName,
      },
      organizationId: orgId,
    });
  }

  const status = typeof body.status === "string" ? body.status : "";
  let orgRow: Record<string, unknown> | null = null;
  if (status && ["active", "suspended", "archived"].includes(status)) {
    const { data, error } = await supabase
      .from("organizations")
      .update({ status })
      .eq("id", orgId)
      .select()
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ error: "Bank not found" }, { status: 404 });
    orgRow = data;

    await writeAudit(supabase, principal, {
      action: "bank_suspended",
      target: data.name,
      targetId: orgId,
      details: `Founder set bank ${data.name} status to ${status}`,
      severity: status === "suspended" ? "warning" : "info",
      metadata: { status },
      organizationId: orgId,
    });
  }

  if (!managerResult && !orgRow) {
    return NextResponse.json(
      {
        error:
          "Provide status (active|suspended|archived) and/or manager fields: manager_email, manager_password, and/or manager_full_name",
      },
      { status: 400 }
    );
  }

  if (managerResult && orgRow) {
    return NextResponse.json({ manager: managerResult, organization: orgRow });
  }
  if (managerResult) {
    return NextResponse.json({ manager: managerResult });
  }
  return NextResponse.json(orgRow);
}
