/**
 * Risk Analytics Service
 *
 * Wraps Supabase operations for `risk_scores` and `compliance_trends` tables.
 * Falls back to mock data if tables are not yet seeded.
 */
import { supabase } from "@/lib/supabase/client";
import type { RiskScore, ComplianceTrend } from "@/types";
import { scoreToOperationalRiskBand } from "@/lib/risk-bands";
import type { RiskScoreRow, ComplianceTrendRow } from "@/lib/supabase/database.types";

// ---------------------------------------------------------------------------
// Shape adapters
// ---------------------------------------------------------------------------

function rowToRiskScore(row: RiskScoreRow): RiskScore {
  const score = row.score;
  return {
    department: row.department,
    score,
    trend: row.trend,
    overdueCount: row.overdue_count,
    riskBand: scoreToOperationalRiskBand(score),
  };
}

function rowToComplianceTrend(row: ComplianceTrendRow): ComplianceTrend {
  return {
    month: row.month,
    score: row.score,
    obligations: row.obligations,
    resolved: row.resolved,
  };
}

// ---------------------------------------------------------------------------
// Service methods
// ---------------------------------------------------------------------------

export const analyticsService = {
  /**
   * Fetch current risk scores for all departments.
   */
  async getRiskScores(): Promise<RiskScore[]> {
    const { data, error } = await supabase
      .from("risk_scores")
      .select("*")
      .order("score", { ascending: true }) as unknown as { data: RiskScoreRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToRiskScore);
  },

  /**
   * Fetch compliance score trends (last N months).
   */
  async getComplianceTrends(months = 6): Promise<ComplianceTrend[]> {
    const { data, error } = await supabase
      .from("compliance_trends")
      .select("*")
      .order("recorded_at", { ascending: true })
      .limit(months) as unknown as { data: ComplianceTrendRow[] | null; error: { message: string } | null };

    if (error || !data) {
      return [];
    }

    return data.map(rowToComplianceTrend);
  },
};
