import type { RequestPrincipal, SurakshaRole } from "@/lib/auth/permissions";

/**
 * Role-relative paths under the generic `/dashboard` tree. For non-founder users
 * with an org, `lib/auth/tenant-routes.ts` rewrites these to
 * `/dashboard/{organizationSlug}/{leaf}` so the tenant is visible in the address bar.
 */
const POST_LOGIN_ROUTE_BY_ROLE: Partial<Record<SurakshaRole, string>> = {
  founder: "/founder",
  bank_manager: "/dashboard/compliance",
  executive_viewer: "/dashboard/executive",
  internal_auditor: "/dashboard/audit",
  external_auditor: "/dashboard/audit",
  security_team: "/dashboard/security",
  it_owner: "/dashboard/security",
  department_owner: "/dashboard/team",
  compliance_admin: "/dashboard/compliance",
  compliance_analyst: "/dashboard/compliance",
};

export function getPostLoginRoute(principal: Pick<RequestPrincipal, "role" | "isFounder"> | null | undefined): string {
  if (!principal) return "/dashboard";
  const mapped = POST_LOGIN_ROUTE_BY_ROLE[principal.role];
  if (mapped) return mapped;
  return "/dashboard";
}

/** True when this user should leave `/dashboard` immediately (avoids flashing Executive UI). */
export function shouldLeaveExecutiveDashboard(
  principal: Pick<RequestPrincipal, "role" | "isFounder"> | null | undefined
): boolean {
  return getPostLoginRoute(principal) !== "/dashboard";
}
