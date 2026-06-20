"use client";

import { TenantDashboardRedirect } from "@/components/tenant/tenant-dashboard-redirect";

export default function LegacyExecutiveDashboardRedirect() {
  return <TenantDashboardRedirect leaf="executive" />;
}
