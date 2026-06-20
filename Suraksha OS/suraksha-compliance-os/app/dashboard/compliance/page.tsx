"use client";

import { TenantDashboardRedirect } from "@/components/tenant/tenant-dashboard-redirect";

export default function LegacyComplianceDashboardRedirect() {
  return <TenantDashboardRedirect leaf="compliance" />;
}
