import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const ROLES = [
  "founder",
  "platform_admin",
  "bank_manager",
  "org_admin",
  "compliance_admin",
  "compliance_analyst",
  "security_team",
  "it_owner",
  "department_owner",
  "internal_auditor",
  "executive_viewer",
  "external_auditor",
] as const;

export type SurakshaRole = (typeof ROLES)[number];

export const ROLE_LABELS: Record<SurakshaRole, string> = {
  founder: "Founder",
  platform_admin: "Platform Admin",
  bank_manager: "Bank Manager",
  org_admin: "Organization Admin",
  compliance_admin: "Compliance Admin",
  compliance_analyst: "Compliance Analyst",
  security_team: "Security Team",
  it_owner: "IT Owner",
  department_owner: "Department Owner",
  internal_auditor: "Internal Auditor",
  executive_viewer: "Executive Viewer",
  external_auditor: "External Auditor",
};

/** Roles that see all departments within their organization (no department scoping). */
export const ORG_WIDE_ROLES: SurakshaRole[] = [
  "founder",
  "platform_admin",
  "bank_manager",
  "org_admin",
  "compliance_admin",
  "compliance_analyst",
  "internal_auditor",
  "executive_viewer",
  "external_auditor",
];

export interface RequestPrincipal {
  userId: string | null;
  email: string;
  organizationId: string | null;
  organizationSlug: string;
  /** Display name of the active organization (bank), when known. */
  organizationName: string | null;
  role: SurakshaRole;
  department: string | null;
  permissions: string[];
  isDemo: boolean;
  /** True for platform founders (global cross-tenant access). */
  isFounder: boolean;
  /** True for roles that see all departments in their org. */
  isOrgWide: boolean;
}

const DEMO_ORG_SLUG = "suraksha-demo-bank";

function isRole(value: string | null | undefined): value is SurakshaRole {
  return !!value && (ROLES as readonly string[]).includes(value);
}

function hasPermission(permissions: string[], permission: string): boolean {
  return permissions.includes("admin.all") || permissions.includes(permission);
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

async function loadPrincipalPermissions(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  role: SurakshaRole
): Promise<string[]> {
  const { data, error } = await supabase
    .from("role_permissions")
    .select("permission")
    .eq("role", role);

  if (error) {
    throw new Error(`Failed to load permissions for ${role}: ${error.message}`);
  }

  return (data ?? []).map((row: { permission: string }) => row.permission);
}

export async function getRequestPrincipal(req: NextRequest): Promise<RequestPrincipal> {
  const token = bearerToken(req);
  if (!token) {
    throw new Error("Authentication required");
  }

  const supabase = getSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) {
    throw new Error("Invalid or expired session");
  }

  const user = userData.user;

  // ── Founder path: global, no organization membership required ────────────────
  const { data: founder } = await supabase
    .from("founders")
    .select("id, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const headerOrg = req.headers.get("x-suraksha-org-id") || null;

  if (founder) {
    let organizationSlug = DEMO_ORG_SLUG;
    let organizationName: string | null = null;
    if (headerOrg) {
      const { data: org } = await supabase
        .from("organizations")
        .select("slug, name")
        .eq("id", headerOrg)
        .maybeSingle();
      organizationSlug = org?.slug ?? organizationSlug;
      organizationName = (org?.name as string | undefined)?.trim() || null;
    }
    return {
      userId: user.id,
      email: user.email ?? (founder.email as string) ?? "founder@suraksha.local",
      organizationId: headerOrg, // null = all orgs; set when drilling into one
      organizationSlug,
      organizationName,
      role: "founder",
      department: null,
      permissions: ["admin.all"],
      isDemo: false,
      isFounder: true,
      isOrgWide: true,
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("current_org_id, default_persona, email, full_name")
    .eq("id", user.id)
    .maybeSingle();

  const requestedOrg = headerOrg || (profile?.current_org_id as string | null) || null;
  let membershipQuery = supabase
    .from("organization_members")
    .select("organization_id, role, department, organizations(slug, name)")
    .eq("user_id", user.id)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: true })  // deterministic ordering for multi-org users
    .limit(1);

  if (requestedOrg) {
    membershipQuery = membershipQuery.eq("organization_id", requestedOrg);
  }

  const { data: memberships, error: memberError } = await membershipQuery;
  if (memberError || !memberships || memberships.length === 0) {
    throw new Error("No active organization membership");
  }

  const membership = memberships[0] as {
    organization_id: string;
    role: string;
    department: string | null;
    organizations?: { slug?: string; name?: string } | { slug?: string; name?: string }[] | null;
  };
  const role = isRole(membership.role) ? membership.role : "compliance_analyst";
  const org = Array.isArray(membership.organizations) ? membership.organizations[0] : membership.organizations;
  const organizationName =
    (org?.name as string | undefined)?.trim() || (org?.slug as string | undefined) || null;
  const rolePermissions = await loadPrincipalPermissions(supabase, role);

  // Merge per-user permission grants (Manager can grant beyond role).
  const { data: userPerms } = await supabase
    .from("user_permissions")
    .select("permission")
    .eq("user_id", user.id)
    .eq("organization_id", membership.organization_id);
  const permissions = Array.from(
    new Set([...rolePermissions, ...(userPerms ?? []).map((r: { permission: string }) => r.permission)])
  );

  return {
    userId: user.id,
    email: user.email ?? (profile?.email as string | undefined) ?? "unknown@suraksha.local",
    organizationId: membership.organization_id,
    organizationSlug: org?.slug ?? DEMO_ORG_SLUG,
    organizationName,
    role,
    department: membership.department,
    permissions,
    isDemo: false,
    isFounder: false,
    isOrgWide: ORG_WIDE_ROLES.includes(role),
  };
}

export async function requireFounder(
  req: NextRequest
): Promise<RequestPrincipal | NextResponse> {
  try {
    const principal = await getRequestPrincipal(req);
    if (!principal.isFounder) {
      return NextResponse.json({ error: "Forbidden", reason: "Founder access required" }, { status: 403 });
    }
    return principal;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function requirePermission(
  req: NextRequest,
  permission: string
): Promise<RequestPrincipal | NextResponse> {
  try {
    const principal = await getRequestPrincipal(req);
    if (!hasPermission(principal.permissions, permission)) {
      return NextResponse.json({ error: "Forbidden", permission }, { status: 403 });
    }
    return principal;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export function hasPrincipalPermission(principal: RequestPrincipal, permission: string): boolean {
  return hasPermission(principal.permissions, permission);
}

export function isDepartmentScopedRole(principal: RequestPrincipal): boolean {
  return ["department_owner", "it_owner", "security_team"].includes(principal.role);
}

export function canAccessRow(principal: RequestPrincipal, row: Record<string, unknown>): boolean {
  if (principal.isFounder || hasPrincipalPermission(principal, "admin.all")) return true;
  if (principal.isOrgWide || ORG_WIDE_ROLES.includes(principal.role)) {
    return true;
  }

  const assignedTo = typeof row.assigned_to === "string" ? row.assigned_to : null;
  const createdBy = typeof row.created_by === "string" ? row.created_by : null;
  if (principal.userId && (assignedTo === principal.userId || createdBy === principal.userId)) {
    return true;
  }

  const rowDepartment = typeof row.department === "string" ? row.department : null;
  if (rowDepartment && principal.department) {
    return rowDepartment.toLowerCase() === principal.department.toLowerCase();
  }

  return !isDepartmentScopedRole(principal);
}

export function filterAccessibleRows<T extends Record<string, unknown>>(
  principal: RequestPrincipal,
  rows: T[] | null | undefined
): T[] {
  return (rows ?? []).filter((row) => canAccessRow(principal, row));
}

export function isAuthResponse(value: RequestPrincipal | NextResponse): value is NextResponse {
  return value instanceof NextResponse;
}

/**
 * Guard for tenant-scoped endpoints: ensures an organization context exists.
 * Non-founders always have one (from their membership); a founder hitting a
 * tenant module must pass `x-suraksha-org-id` (the org drill-down UI does this).
 * Returns a 400 NextResponse when missing, otherwise null.
 */
export function requireOrgContext(principal: RequestPrincipal): NextResponse | null {
  if (!principal.organizationId) {
    return NextResponse.json(
      { error: "Organization context required. Founders must pass x-suraksha-org-id." },
      { status: 400 }
    );
  }
  return null;
}

export function withOrg<T extends Record<string, unknown>>(
  principal: RequestPrincipal,
  payload: T
): T & { organization_id?: string; created_by?: string } {
  return {
    ...payload,
    ...(principal.organizationId && { organization_id: principal.organizationId }),
    ...(principal.userId && { created_by: principal.userId }),
  };
}
