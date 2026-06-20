/**
 * GET /api/analytics — org-scoped analytics overview.
 *
 * Normalized BFF read path (replaces browser-direct anon reads of risk_scores /
 * compliance_trends). Tenant users get their own org; a founder without an org
 * selected gets a platform-wide aggregate (guarded by principal.isFounder).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

interface DeptRow { department: string; score: number; trend: string; overdue_count: number; total_obligations: number }
interface TrendRow { month: string; year: number; score: number; obligations: number; resolved: number }

const MONTH_ORDER: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();

  // Founder platform-wide view (no org selected): aggregate across all tenants.
  if (principal.isFounder && !principal.organizationId) {
    const [risk, trends, obl, docs, evid, notifs, esc] = await Promise.all([
      supabase.from("risk_scores").select("department, score, trend, overdue_count, total_obligations").order("score", { ascending: false }),
      supabase.from("compliance_trends").select("month, year, score, obligations, resolved"),
      supabase.from("obligations").select("status, due_date"),
      supabase.from("documents").select("status"),
      supabase.from("evidence").select("collected_at"),
      supabase.from("notifications").select("read"),
      supabase.from("escalations").select("status"),
    ]);
    const trendRows = (trends.data ?? []) as TrendRow[];
    trendRows.sort((a, b) => a.year - b.year || (MONTH_ORDER[a.month] ?? 0) - (MONTH_ORDER[b.month] ?? 0));
    const oblRows = (obl.data ?? []) as { status: string; due_date: string }[];
    const today = new Date().toISOString().split("T")[0];
    return NextResponse.json({
      risk_by_dept: (risk.data ?? []) as DeptRow[],
      compliance_trend: trendRows,
      total_obligations: oblRows.length,
      compliant_count: oblRows.filter((o) => o.status === "compliant").length,
      overdue_count: oblRows.filter((o) => o.due_date < today && o.status !== "compliant").length,
      docs_processed: ((docs.data ?? []) as { status: string }[]).filter((d) => d.status === "processed").length,
      evidence_collected: ((evid.data ?? []) as { collected_at: string | null }[]).filter((e) => !!e.collected_at).length,
      open_notifications: ((notifs.data ?? []) as { read: boolean }[]).filter((n) => !n.read).length,
      pending_escalations: ((esc.data ?? []) as { status: string }[]).filter((e) => e.status === "open").length,
    });
  }

  // Tenant (or founder-with-org) view: org-scoped RPC.
  const { data, error } = await supabase.rpc("get_analytics_overview", { p_org_id: principal.organizationId });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? {});
}
