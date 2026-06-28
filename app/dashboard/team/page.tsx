"use client";

import { TenantDashboardRedirect } from "@/components/tenant/tenant-dashboard-redirect";

export default function LegacyTeamDashboardRedirect() {
  return <TenantDashboardRedirect leaf="team" />;
}
