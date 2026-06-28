"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePrincipal } from "@/hooks/use-principal";
import type { TenantDashboardLeaf } from "@/lib/auth/tenant-routes";

export function TenantDashboardRedirect({ leaf }: { leaf: TenantDashboardLeaf }) {
  const router = useRouter();
  const { principal, isLoading } = usePrincipal();

  useEffect(() => {
    if (isLoading) return;
    if (!principal) {
      router.replace("/login");
      return;
    }
    if (principal.isFounder) {
      router.replace("/founder");
      return;
    }
    const slug = principal.organizationSlug;
    if (!slug) {
      router.replace("/login");
      return;
    }
    router.replace(`/dashboard/${encodeURIComponent(slug)}/${leaf}`);
  }, [isLoading, principal, router, leaf]);

  return (
    <div className="min-h-[40vh] flex items-center justify-center text-sm text-[#8c90a1]">
      Redirecting to your bank workspace…
    </div>
  );
}
