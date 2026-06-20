"use client";

import { TenantDashboardRedirect } from "@/components/tenant/tenant-dashboard-redirect";

export default function LegacySecurityDashboardRedirect() {
  return <TenantDashboardRedirect leaf="security" />;
}
