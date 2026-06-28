import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { filterAccessibleRows, isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

// GET — return or compute readiness scores for all departments
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  try {
    const supabase = getSupabaseServerClient();

    // Fetch obligations grouped by department
    const { data: obligations } = await supabase
      .from("obligations")
      .select("id, department, status, priority, due_date, evidence_count, compliance_risk")
      .eq("organization_id", principal.organizationId!);

    const { data: evidence } = await supabase
      .from("evidence")
      .select("id, obligation_id, collected_at")
      .eq("organization_id", principal.organizationId!);

    const { data: storedScores } = await supabase
      .from("readiness_scores")
      .select("*")
      .eq("organization_id", principal.organizationId!)
      .order("score", { ascending: false });

    if (!obligations || obligations.length === 0) {
      // Return stored scores if available
      if (storedScores && storedScores.length > 0) return NextResponse.json(filterAccessibleRows(principal, storedScores));
      // Otherwise fall through to hardcoded defaults at end of function
    }

    // Build department-level scores from live data
    const deptMap: Record<string, DeptData> = {};
    (obligations ?? []).forEach((obl) => {
      const dept = obl.department ?? "Compliance";
      if (!deptMap[dept]) {
        deptMap[dept] = { total: 0, compliant: 0, overdue: 0, missingEvidence: 0, auditGaps: 0 };
      }
      const d = deptMap[dept];
      d.total++;
      if (["compliant"].includes(obl.status ?? "")) d.compliant++;
      if (obl.status === "overdue") d.overdue++;

      // Count evidence
      const oblEvidence = (evidence ?? []).filter(e => e.obligation_id === obl.id);
      const collectedEvidence = oblEvidence.filter(e => !!e.collected_at);
      if (oblEvidence.length === 0 || collectedEvidence.length === 0) d.missingEvidence++;

      // Audit gap = high/critical overdue
      if (obl.status === "overdue" && ["critical","high"].includes(obl.priority ?? "")) d.auditGaps++;
    });

    // Compute scores and upsert
    const scores = Object.entries(deptMap).map(([dept, d]) => {
      const baseScore = d.total === 0 ? 0 :
        ((d.compliant / d.total) * 60) +
        (Math.max(0, 1 - d.overdue / d.total) * 20) +
        (Math.max(0, 1 - d.missingEvidence / d.total) * 15) +
        (Math.max(0, 1 - d.auditGaps / d.total) * 5);

      const score = Math.min(100, Math.max(0, Math.round(baseScore)));
      const status = score >= 85 ? "healthy" : score >= 70 ? "warning" : score >= 50 ? "at_risk" : "critical";

      return {
        department: dept,
        score,
        max_score: 100,
        status,
        total_obligations: d.total,
        compliant_count: d.compliant,
        overdue_count: d.overdue,
        missing_evidence: d.missingEvidence,
        audit_gaps: d.auditGaps,
        computed_at: new Date().toISOString(),
      };
    });

    // Try to upsert scores (silently ignore if table doesn't exist)
    if (scores.length > 0) {
      try {
        // Upsert using (department, organization_id) composite to prevent cross-org collisions.
        // We delete existing rows for this org+dept combo then re-insert.
        if (principal.organizationId) {
          await supabase.from("readiness_scores")
            .delete()
            .eq("organization_id", principal.organizationId)
            .in("department", scores.map(s => s.department));
        }
        await supabase.from("readiness_scores").insert(
          scores.map((score) => ({
            ...score,
            ...(principal.organizationId && { organization_id: principal.organizationId }),
          }))
        );
      } catch {
        // table doesn't exist yet — return computed data directly
      }
    }

    // Return live computed scores
    if (scores.length > 0) {
      return NextResponse.json(filterAccessibleRows(principal, scores.sort((a, b) => b.score - a.score)));
    }

    // No live obligations — fetch stored scores from DB
    let storedFinalQuery = supabase.from("readiness_scores").select("*").order("score", { ascending: false });
    if (principal.organizationId) storedFinalQuery = storedFinalQuery.eq("organization_id", principal.organizationId);
    const { data: storedFinal } = await storedFinalQuery;
    if (storedFinal && storedFinal.length > 0) return NextResponse.json(filterAccessibleRows(principal, storedFinal));

    // No data at all — return empty array
    return NextResponse.json([]);
  } catch (err) {
    console.error("[readiness]", err);
    return NextResponse.json([], { status: 500 });
  }
}

interface DeptData {
  total: number;
  compliant: number;
  overdue: number;
  missingEvidence: number;
  auditGaps: number;
}
