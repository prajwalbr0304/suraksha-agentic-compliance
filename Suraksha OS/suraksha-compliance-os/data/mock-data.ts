import { NavItem } from "@/types";

/** Standard tenant / role-based navigation (not shown to platform founders in the main shell). */
/** Order matches Bank Manager console: ops modules first, then reports/audit/agents, then org admin, then platform analytics. */
export const navigationItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: "LayoutDashboard" },
  { title: "Upload", href: "/upload", icon: "Upload", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { title: "Documents", href: "/documents", icon: "FolderOpen" },
  { title: "Regulation Center", href: "/regulation-center", icon: "Landmark", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor"] },
  { title: "Obligations", href: "/obligations", icon: "Scale", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "department_owner"] },
  { title: "Compliance Action Board", href: "/map-board", icon: "GitBranch", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner"] },
  { title: "My tasks", href: "/my-tasks", icon: "ClipboardList", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner"] },
  { title: "Knowledge Graph", href: "/knowledge-graph", icon: "Network", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor"] },
  { title: "Regulatory Change Analysis", href: "/drift", icon: "GitCompare", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst"] },
  { title: "Readiness", href: "/readiness", icon: "ShieldCheck" },
  { title: "Evidence", href: "/evidence", icon: "FileSearch", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "department_owner", "internal_auditor", "external_auditor"] },
  { title: "Compliance Impact Analysis", href: "/impact", icon: "Zap", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "executive_viewer"] },
  { title: "Security Findings", href: "/security-findings", icon: "Shield", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "security_team", "it_owner"] },
  { title: "Reports", href: "/reports", icon: "FileBarChart", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "internal_auditor", "executive_viewer", "external_auditor"] },
  { title: "Audit Trail", href: "/audit", icon: "ScrollText", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "internal_auditor", "external_auditor"] },
  { title: "Agents", href: "/agents", icon: "Bot", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin", "compliance_analyst", "security_team", "it_owner", "internal_auditor"] },
  { title: "Users", href: "/admin/users", icon: "Users", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { title: "Departments", href: "/admin/departments", icon: "Building2", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { title: "Teams", href: "/admin/teams", icon: "UsersRound", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { title: "Access Control", href: "/admin/access", icon: "KeyRound", personas: ["platform_admin", "org_admin", "bank_manager"] },
  { title: "Settings", href: "/settings", icon: "Settings", personas: ["platform_admin", "org_admin", "bank_manager", "compliance_admin"] },
  { title: "Analytics", href: "/analytics", icon: "BarChart3", personas: ["platform_admin", "org_admin", "compliance_admin", "internal_auditor", "executive_viewer"] },
];

/** Platform-level navigation for founders only (no tenant operational modules here). */
export const founderNavigationItems: NavItem[] = [
  { title: "Dashboard", href: "/founder", icon: "LayoutDashboard" },
  { title: "Organizations", href: "/founder/organizations", icon: "Building2" },
  { title: "Managers", href: "/founder/managers", icon: "UsersRound" },
  { title: "Users", href: "/founder/users", icon: "Users" },
  { title: "Agents", href: "/agents", icon: "Bot" },
  { title: "Analytics", href: "/analytics", icon: "BarChart3" },
  { title: "Reports", href: "/reports", icon: "FileBarChart" },
  { title: "Audit Trail", href: "/audit", icon: "ScrollText" },
  { title: "Access Control", href: "/founder/access", icon: "KeyRound" },
  { title: "Settings", href: "/settings", icon: "Settings" },
];

export const allNavigationItems: NavItem[] = [...founderNavigationItems, ...navigationItems];
