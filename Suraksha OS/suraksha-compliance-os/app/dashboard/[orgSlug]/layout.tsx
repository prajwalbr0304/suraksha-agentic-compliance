"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { usePrincipal } from "@/hooks/use-principal";

/**
 * Validates `orgSlug` in the URL against the signed-in principal's organization.
 * Wrong slug → replace with the correct tenant path (same leaf) for data-isolation clarity.
 */
export default function TenantDashboardSegmentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const router = useRouter();
  const { principal, isLoading } = usePrincipal();
  const orgSlug = typeof params.orgSlug === "string" ? params.orgSlug : "";

  useEffect(() => {
    if (isLoading || !principal || principal.isFounder) return;
    const expected = principal.organizationSlug;
    if (!expected || !orgSlug) return;
    if (decodeURIComponent(orgSlug) !== expected) {
      const tail = pathname.replace(/^\/dashboard\/[^/]+/, "") || "/compliance";
      router.replace(`/dashboard/${encodeURIComponent(expected)}${tail}`);
    }
  }, [isLoading, principal, orgSlug, pathname, router]);

  return <>{children}</>;
}
