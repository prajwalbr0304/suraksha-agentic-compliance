import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const supabase = getSupabaseServerClient();
    const query = supabase
      .from("impact_simulations")
      .select("*, documents(filename, uploaded_at)")
      .order("created_at", { ascending: false })
      .limit(20)
      .eq("organization_id", principal.organizationId!);
    const { data, error } = await query;
    if (!error && data) return NextResponse.json(data);
    // Table doesn't exist — return empty
    return NextResponse.json([]);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const { document_id } = await req.json();
    if (!document_id) return NextResponse.json({ error: "document_id required" }, { status: 400 });

    const supabase = getSupabaseServerClient();

    // Verify document belongs to caller's org (IDOR fix)
    if (principal.organizationId) {
      const { data: docCheck } = await supabase.from("documents").select("id").eq("id", document_id).eq("organization_id", principal.organizationId).maybeSingle();
      if (!docCheck) return NextResponse.json({ error: "Document not found in your organization" }, { status: 403 });
    }

    // Fetch document and its obligations (org-scoped)
    let oblQuery = supabase.from("obligations").select("department, priority, compliance_risk, evidence_required").eq("document_id", document_id);
    if (principal.organizationId) oblQuery = oblQuery.eq("organization_id", principal.organizationId);
    const [{ data: doc }, { data: obligations }] = await Promise.all([
      supabase.from("documents").select("filename, summary, regulation_name").eq("id", document_id).maybeSingle(),
      oblQuery,
    ]);

    const oblList = obligations ?? [];

    // Compute impact
    const deptCounts: Record<string, number> = {};
    oblList.forEach(o => {
      if (o.department) deptCounts[o.department] = (deptCounts[o.department] ?? 0) + 1;
    });

    const criticalCount = oblList.filter(o => o.priority === "critical").length;
    const highCount = oblList.filter(o => o.priority === "high").length;
    const totalObligations = oblList.length;

    const impactedTeams = Object.entries(deptCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([dept, count]) => ({
        department: dept,
        obligation_count: count,
        estimated_hours: count * 12 + (criticalCount > 0 ? 20 : 0),
      }));

    const engineeringEffort = impactedTeams.reduce((a, t) => a + t.estimated_hours, 0);

    const riskLevel: "critical" | "high" | "medium" | "low" = criticalCount >= 3 ? "critical" : criticalCount >= 1 ? "high" : highCount >= 3 ? "medium" : "low";
    const auditRisk: "critical" | "high" | "medium" | "low" = criticalCount >= 2 ? "critical" : highCount >= 2 ? "high" : "medium";
    const operationalRisk: "critical" | "high" | "medium" | "low" = totalObligations >= 10 ? "high" : totalObligations >= 5 ? "medium" : "low";
    const complexity: "high" | "medium" | "low" = impactedTeams.length >= 4 ? "high" : impactedTeams.length >= 2 ? "medium" : "low";
    const estimatedWeeks = Math.ceil(engineeringEffort / 40);

    const affectedControls: string[] = [];
    if (deptCounts["IT"]) affectedControls.push("Cyber Security Controls", "IT Risk Management");
    if (deptCounts["Compliance"]) affectedControls.push("Compliance Monitoring Framework");
    if (deptCounts["Risk Management"]) affectedControls.push("Risk Assessment Procedures");
    if (deptCounts["Fraud & AML"]) affectedControls.push("AML Transaction Monitoring", "KYC/CDD Procedures");
    if (deptCounts["Internal Audit"]) affectedControls.push("Audit Schedule & Coverage");

    const riskLabel = { critical: "Critical", high: "High", medium: "Moderate", low: "Low" };
    const summary = `Analysis of "${doc?.filename ?? "document"}" reveals ${totalObligations} obligations impacting ${impactedTeams.length} departments. ` +
      `Risk level: ${riskLabel[riskLevel]}. Estimated ${engineeringEffort} engineering hours across ${estimatedWeeks} weeks for full remediation. ` +
      `${criticalCount} critical obligation(s) require immediate attention.`;

    // Try to persist simulation (may not exist if migration not run yet)
    let simId: string | undefined;
    const impactPayload = {
      document_id, regulation_name: doc?.regulation_name ?? doc?.filename ?? "",
      impacted_teams: impactedTeams, engineering_effort: engineeringEffort,
      risk_level: riskLevel, audit_risk: auditRisk, operational_risk: operationalRisk,
      complexity, estimated_weeks: estimatedWeeks, summary,
      affected_controls: affectedControls, budget_estimate: engineeringEffort * 2500,
      ...(principal.organizationId && { organization_id: principal.organizationId }),
    };
    try {
      const { data: simulation, error: simErr } = await supabase
        .from("impact_simulations").insert(impactPayload).select("id").single();
      if (!simErr && simulation) simId = simulation.id;
    } catch {
      // Table doesn't exist yet — return result without persisting
    }

    return NextResponse.json({
      id: simId,
      summary,
      impacted_teams: impactedTeams,
      engineering_effort: engineeringEffort,
      estimated_weeks: estimatedWeeks,
      risk_level: riskLevel,
      audit_risk: auditRisk,
      operational_risk: operationalRisk,
      complexity,
      affected_controls: affectedControls,
      total_obligations: totalObligations,
      critical_count: criticalCount,
      budget_estimate: engineeringEffort * 2500,
    });
  } catch (err) {
    console.error("[impact]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
