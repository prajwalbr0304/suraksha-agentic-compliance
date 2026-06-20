import type { RequestPrincipal } from "@/lib/auth/permissions";
import { getPostLoginRoute } from "@/lib/auth/post-login-route";

/** Role-dashboard paths that are scoped under `/dashboard/[organizationSlug]/…`. */
export const TENANT_DASHBOARD_LEAVES = ["compliance", "executive", "audit", "security", "team"] as const;
export type TenantDashboardLeaf = (typeof TENANT_DASHBOARD_LEAVES)[number];

export function getTenantDashboardBase(principal: Pick<RequestPrincipal, "isFounder" | "organizationSlug"> | null): string | null {
  if (!principal || principal.isFounder) return null;
  const slug = principal.organizationSlug;
  if (!slug) return null;
  return `/dashboard/${encodeURIComponent(slug)}`;
}

/**
 * Post-login URL for the current principal. Non-founders with an org use
 * `/dashboard/{organizationSlug}/{compliance|executive|…}` so the tenant is visible in the address bar.
 */
export function getTenantPostLoginRoute(principal: RequestPrincipal): string {
  if (principal.isFounder) return getPostLoginRoute(principal);
  const base = getTenantDashboardBase(principal);
  if (!base) return getPostLoginRoute({ role: principal.role, isFounder: false });
  const leaf = getPostLoginRoute({ role: principal.role, isFounder: false });
  if (leaf === "/dashboard") return "/dashboard";
  for (const name of TENANT_DASHBOARD_LEAVES) {
    if (leaf === `/dashboard/${name}`) return `${base}/${name}`;
  }
  return leaf;
}

/** Home link for the first sidebar item ("Dashboard") for tenant users. */
export function getTenantDashboardHomeHref(principal: RequestPrincipal | null): string {
  if (!principal) return "/dashboard";
  if (principal.isFounder) return "/founder";
  const tenant = getTenantPostLoginRoute(principal);
  return tenant || "/dashboard";
}

/** Rewrite known role-dashboard links to include org slug (other hrefs unchanged). */
export function withTenantDashboardHref(
  href: string,
  principal: Pick<RequestPrincipal, "isFounder" | "organizationSlug"> | null | undefined
): string {
  if (!principal || principal.isFounder) return href;
  const base = getTenantDashboardBase(principal as RequestPrincipal);
  if (!base) return href;
  for (const name of TENANT_DASHBOARD_LEAVES) {
    if (href === `/dashboard/${name}`) return `${base}/${name}`;
  }
  return href;
}

/**
 * Canonical tenant UI path: `/dashboard/{organizationSlug}` + module path.
 * Keeps the active bank visible in the address bar for every main nav item (not only role dashboards).
 */
export function withTenantWorkspaceHref(
  href: string,
  principal: Pick<RequestPrincipal, "isFounder" | "organizationSlug" | "role"> | null | undefined
): string {
  if (!principal || principal.isFounder) return href;
  if (href === "/dashboard") return getTenantDashboardHomeHref(principal as RequestPrincipal);
  const dashPrefixed = withTenantDashboardHref(href, principal);
  if (dashPrefixed !== href) return dashPrefixed;
  const base = getTenantDashboardBase(principal as RequestPrincipal);
  if (!base) return href;
  if (href.startsWith("/founder") || href.startsWith("/login") || href.startsWith("/api")) return href;
  if (href.startsWith(`${base}/`) || href === base) return href;
  if (href.startsWith("/")) return `${base}${href}`;
  return href;
}

/** If the user is on a legacy bare path, return the slugged workspace URL (else null). */
export function getTenantPathRedirect(
  pathname: string | null | undefined,
  principal: RequestPrincipal | null
): string | null {
  if (!pathname || !principal?.organizationSlug || principal.isFounder) return null;
  const base = getTenantDashboardBase(principal);
  if (!base) return null;
  if (pathname.startsWith("/founder") || pathname.startsWith("/login")) return null;
  if (pathname.startsWith("/forgot-password") || pathname.startsWith("/reset-password")) return null;
  if (pathname === base || pathname.startsWith(`${base}/`)) return null;
  const legacy = pathname.match(/^\/dashboard\/([^/]+)$/);
  const leaf = legacy?.[1];
  if (leaf && (TENANT_DASHBOARD_LEAVES as readonly string[]).includes(leaf)) {
    return `${base}/${leaf}`;
  }
  if (pathname === "/dashboard") return null;
  const workspaceRoots =
    /^\/(upload|documents|obligations|map-board|my-tasks|knowledge-graph|drift|readiness|evidence|impact|security-findings|reports|audit|agents|settings|analytics)(\/|$)/.test(
      pathname
    ) || pathname.startsWith("/admin/");
  if (workspaceRoots) return `${base}${pathname}`;
  return null;
}

/** Match sidebar/nav href against current pathname (supports `/dashboard/{slug}/…`). */
export function navigationHrefMatches(
  pathname: string | null | undefined,
  navHref: string,
  principal: RequestPrincipal | null
): boolean {
  if (!pathname) return false;
  if (navHref === "/founder") return pathname === "/founder";
  const resolved =
    !principal || principal.isFounder
      ? navHref
      : navHref === "/dashboard"
        ? getTenantDashboardHomeHref(principal)
        : withTenantWorkspaceHref(navHref, principal);
  if (pathname === resolved) return true;
  // Generic `/dashboard` home must not match tenant slug routes (`/dashboard/{slug}/compliance`, …).
  if (resolved === "/dashboard") {
    if (pathname === "/dashboard") return true;
    const legacy = pathname.match(/^\/dashboard\/([^/]+)$/);
    const leaf = legacy?.[1];
    return !!leaf && (TENANT_DASHBOARD_LEAVES as readonly string[]).includes(leaf);
  }
  return pathname.startsWith(`${resolved}/`);
}
