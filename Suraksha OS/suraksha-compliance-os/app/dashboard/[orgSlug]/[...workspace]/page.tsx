"use client";

import { notFound, useParams } from "next/navigation";
import AdminAccessPage from "@/app/admin/access/page";
import AdminDepartmentsPage from "@/app/admin/departments/page";
import AdminTeamsPage from "@/app/admin/teams/page";
import AdminUsersPage from "@/app/admin/users/page";
import AgentsPage from "@/app/agents/page";
import AnalyticsPage from "@/app/analytics/page";
import AuditTrailPage from "@/app/audit/page";
import DocumentsPage from "@/app/documents/page";
import DriftPage from "@/app/drift/page";
import EvidencePage from "@/app/evidence/page";
import ImpactPage from "@/app/impact/page";
import KnowledgeGraphPage from "@/app/knowledge-graph/page";
import MapBoardPage from "@/app/map-board/page";
import MyTasksPage from "@/app/my-tasks/page";
import ObligationsPage from "@/app/obligations/page";
import ReadinessPage from "@/app/readiness/page";
import ReportsPage from "@/app/reports/page";
import SecurityFindingsPage from "@/app/security-findings/page";
import SettingsPage from "@/app/settings/page";
import UploadPage from "@/app/upload/page";

/**
 * Renders tenant app modules under `/dashboard/{organizationSlug}/…` so the URL
 * always carries the workspace slug (static `compliance` / `executive` / … routes win first).
 */
export default function TenantWorkspaceCatchAllPage() {
  const params = useParams();
  const raw = params.workspace;
  const segments = Array.isArray(raw) ? raw : raw != null ? [String(raw)] : [];
  const key = segments.map((s) => decodeURIComponent(s)).join("/");

  switch (key) {
    case "upload":
      return <UploadPage />;
    case "documents":
      return <DocumentsPage />;
    case "obligations":
      return <ObligationsPage />;
    case "map-board":
      return <MapBoardPage />;
    case "my-tasks":
      return <MyTasksPage />;
    case "knowledge-graph":
      return <KnowledgeGraphPage />;
    case "drift":
      return <DriftPage />;
    case "readiness":
      return <ReadinessPage />;
    case "evidence":
      return <EvidencePage />;
    case "impact":
      return <ImpactPage />;
    case "security-findings":
      return <SecurityFindingsPage />;
    case "reports":
      return <ReportsPage />;
    case "audit":
      return <AuditTrailPage />;
    case "agents":
      return <AgentsPage />;
    case "settings":
      return <SettingsPage />;
    case "analytics":
      return <AnalyticsPage />;
    case "admin/users":
      return <AdminUsersPage />;
    case "admin/teams":
      return <AdminTeamsPage />;
    case "admin/departments":
      return <AdminDepartmentsPage />;
    case "admin/access":
      return <AdminAccessPage />;
    default:
      notFound();
  }
}
