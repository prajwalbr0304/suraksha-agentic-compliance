/**
 * GET /api/reports — org-scoped aggregated compliance report payload.
 *
 * Normalized BFF read path (replaces the browser-direct anon queries that the
 * Reports page used). Tenant users get their own org; a founder without an org
 * selected gets a platform-wide aggregate.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "reports.export");
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();
  const scoped = principal.isFounder && !principal.organizationId ? null : principal.organizationId;

  let oblQ = supabase.from("obligations").select("id,status,priority,department");
  let docQ = supabase.from("documents").select("id,status");
  let mapQ = supabase.from("map_cards").select("id,status");
  if (scoped) {
    oblQ = oblQ.eq("organization_id", scoped);
    docQ = docQ.eq("organization_id", scoped);
    mapQ = mapQ.eq("organization_id", scoped);
  }
  const [oblRes, docRes, mapRes] = await Promise.all([oblQ, docQ, mapQ]);

  const obls = (oblRes.data ?? []) as { id: string; status: string; priority: string; department: string }[];
  const docs = (docRes.data ?? []) as { id: string; status: string }[];
  const maps = (mapRes.data ?? []) as { id: string; status: string }[];

  const mapCount = (s: string) => maps.filter((m) => m.status === s).length;

  const total = obls.length;
  const compliant = obls.filter((o) => o.status === "compliant").length;
  const deptMap = new Map<string, { count: number; compliant: number }>();
  for (const o of obls) {
    const dept = o.department || "Unknown";
    const prev = deptMap.get(dept) ?? { count: 0, compliant: 0 };
    deptMap.set(dept, { count: prev.count + 1, compliant: prev.compliant + (o.status === "compliant" ? 1 : 0) });
  }
  const priorityMap = new Map<string, number>();
  for (const o of obls) { const p = o.priority || "medium"; priorityMap.set(p, (priorityMap.get(p) ?? 0) + 1); }

  return NextResponse.json({
    totalObligations: total,
    compliant,
    atRisk: obls.filter((o) => o.status === "at_risk").length,
    overdue: obls.filter((o) => o.status === "overdue").length,
    inProgress: obls.filter((o) => o.status === "in_progress").length,
    pendingReview: obls.filter((o) => o.status === "pending_review").length,
    totalDocs: docs.length,
    processedDocs: docs.filter((d) => d.status === "processed").length,
    byDepartment: Array.from(deptMap.entries()).map(([dept, v]) => ({ dept, count: v.count, compliant: v.compliant })).sort((a, b) => b.count - a.count),
    byPriority: Array.from(priorityMap.entries()).map(([priority, count]) => ({ priority, count })),
    mapStats: {
      ai_generated: mapCount("ai_generated"),
      approved: mapCount("approved"),
      assigned: mapCount("assigned"),
      in_progress: mapCount("in_progress"),
      under_review: mapCount("under_review") + mapCount("review"),
      completed: mapCount("completed"),
      rejected: mapCount("rejected"),
      escalated: mapCount("escalated"),
      backlog: mapCount("backlog"),
    },
    complianceScore: total > 0 ? Math.round((compliant / total) * 100) : 0,
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "long", timeStyle: "short" }),
  });
}
