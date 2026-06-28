import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

// POST — run a specific migration step (server-side, service role only)
// Body: { step: string, sql?: string }
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "settings.manage");
  if (isAuthResponse(principal)) return principal;

  try {
    const { step } = await req.json();
    const supabase = getSupabaseServerClient();
    const results: Record<string, unknown> = {};
    const orgId = principal.organizationId ?? null;
    const withOrgId = <T extends Record<string, unknown>>(row: T) => (orgId ? { ...row, organization_id: orgId } : row);

    // Seed notifications if table exists
    if (step === "seed_notifications") {
      const seeds = [
        { title: "Overdue Obligation Detected", message: "3 obligations in IT department are past their deadline.", type: "escalation" },
        { title: "New Circular Processed", message: "RBI Circular has been extracted — obligations identified.", type: "success" },
        { title: "Readiness Score Dropped", message: "IT department readiness score fell below 60% threshold.", type: "warning" },
        { title: "Evidence Gap Alert", message: "VA/PT obligation has 0 evidence items collected.", type: "error" },
        { title: "MAP Card Escalated", message: "SOC Monitoring implementation is 14 days overdue — escalated to CISO.", type: "escalation" },
      ].map(withOrgId);
      const { error } = await supabase.from("notifications").upsert(seeds, { ignoreDuplicates: true });
      results.notifications = error ? `error: ${error.message}` : "ok";
    }

    // Seed readiness scores
    if (step === "seed_readiness") {
      const seeds = [
        { department: "Compliance", score: 82, max_score: 100, status: "warning", total_obligations: 18, compliant_count: 15, overdue_count: 2, missing_evidence: 3, audit_gaps: 1, recommendations: JSON.stringify(["Schedule quarterly review","Update PMLA policy documentation"]) },
        { department: "Risk Management", score: 74, max_score: 100, status: "warning", total_obligations: 12, compliant_count: 9, overdue_count: 1, missing_evidence: 4, audit_gaps: 2, recommendations: JSON.stringify(["Complete RCSA exercise","Update risk appetite framework"]) },
        { department: "IT", score: 61, max_score: 100, status: "at_risk", total_obligations: 22, compliant_count: 13, overdue_count: 4, missing_evidence: 7, audit_gaps: 3, recommendations: JSON.stringify(["Conduct VA/PT","Implement SOC 2.0","Patch critical vulnerabilities"]) },
        { department: "Legal", score: 91, max_score: 100, status: "healthy", total_obligations: 8, compliant_count: 8, overdue_count: 0, missing_evidence: 1, audit_gaps: 0, recommendations: JSON.stringify(["Archive completed matters"]) },
        { department: "Finance", score: 88, max_score: 100, status: "healthy", total_obligations: 10, compliant_count: 9, overdue_count: 0, missing_evidence: 2, audit_gaps: 0, recommendations: JSON.stringify(["Submit Q4 capital adequacy report"]) },
        { department: "Operations", score: 69, max_score: 100, status: "at_risk", total_obligations: 15, compliant_count: 10, overdue_count: 3, missing_evidence: 5, audit_gaps: 2, recommendations: JSON.stringify(["Update BCP document","Test DR plan"]) },
        { department: "Internal Audit", score: 95, max_score: 100, status: "healthy", total_obligations: 6, compliant_count: 6, overdue_count: 0, missing_evidence: 0, audit_gaps: 0, recommendations: JSON.stringify(["Complete IS audit schedule"]) },
        { department: "Fraud & AML", score: 57, max_score: 100, status: "critical", total_obligations: 14, compliant_count: 8, overdue_count: 5, missing_evidence: 6, audit_gaps: 4, recommendations: JSON.stringify(["File pending STRs","Conduct AML training","Update transaction monitoring rules"]) },
      ].map(withOrgId);
      // readiness_scores has no unique constraint; delete this org's rows then insert.
      if (orgId) {
        await supabase.from("readiness_scores").delete().eq("organization_id", orgId).in("department", seeds.map((s) => s.department));
      }
      const { error } = await supabase.from("readiness_scores").insert(seeds);
      results.readiness_scores = error ? `error: ${error.message}` : "ok";
    }

    // Check which new tables exist
    if (step === "check") {
      const tables = ["regulatory_versions","drift_comparisons","readiness_scores","impact_simulations","graph_relationships","notifications","escalations","departments"];
      for (const t of tables) {
        const { error } = await supabase.from(t).select("id").limit(1);
        results[t] = error ? `MISSING: ${error.message}` : "EXISTS";
      }
    }

    return NextResponse.json({ step, results });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "settings.manage");
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();
  const tables = ["regulatory_versions","drift_comparisons","readiness_scores","impact_simulations","graph_relationships","notifications","escalations","departments"];
  const status: Record<string, boolean> = {};
  for (const t of tables) {
    const { error } = await supabase.from(t).select("id").limit(1);
    status[t] = !error;
  }
  return NextResponse.json({ status, migrationRequired: Object.values(status).some(v => !v) });
}
