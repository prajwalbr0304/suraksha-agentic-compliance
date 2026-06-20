"use client";

import { TenantDashboardRedirect } from "@/components/tenant/tenant-dashboard-redirect";

export default function LegacyAuditDashboardRedirect() {
  return <TenantDashboardRedirect leaf="audit" />;
}
