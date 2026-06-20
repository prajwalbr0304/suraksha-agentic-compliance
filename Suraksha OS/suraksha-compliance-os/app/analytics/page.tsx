"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { ChartContainer } from "@/components/ui/chart-container";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { KPISkeleton, ErrorState } from "@/components/ui/loading-states";
import type { RiskScore, ComplianceTrend } from "@/types";
import { scoreToOperationalRiskBand } from "@/lib/risk-bands";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  ShieldCheck,
  Target,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from "recharts";

const trendIcons = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
};

const trendColors: Record<string, string> = {
  up: "text-emerald-400",
  down: "text-red-400",
  stable: "text-[#8c90a1]",
};

interface AnalyticsOverview {
  risk_by_dept: { department: string; score: number; trend: string; overdue_count: number; total_obligations: number }[];
  compliance_trend: { month: string; year: number; score: number; obligations: number; resolved: number }[];
}

export default function AnalyticsPage() {
  const api = useTenantApi();
  const [riskScores, setRiskScores] = useState<RiskScore[]>([]);
  const [complianceTrends, setComplianceTrends] = useState<ComplianceTrend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api("/api/analytics");
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || "Failed to load analytics");
      }
      const data = (await res.json()) as AnalyticsOverview;
      setRiskScores((data.risk_by_dept ?? []).map((r) => {
        const score = r.score;
        return {
          department: r.department,
          score,
          trend: (r.trend as "up" | "down" | "stable") ?? "stable",
          overdueCount: r.overdue_count ?? 0,
          riskBand: scoreToOperationalRiskBand(score),
        };
      }));
      setComplianceTrends((data.compliance_trend ?? []).map((r) => ({
        month: r.month,
        score: r.score,
        obligations: r.obligations,
        resolved: r.resolved,
      })));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load analytics");
    } finally {
      setIsLoading(false);
    }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const riskRefetch = load;
  const trendsRefetch = load;

  const totalOverdue = riskScores.reduce((sum: number, r: RiskScore) => sum + r.overdueCount, 0);
  const overallScore = riskScores.length > 0
    ? Math.round(riskScores.reduce((sum: number, r: RiskScore) => sum + r.score, 0) / riskScores.length * 10) / 10
    : 0;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Risk & Analytics" description="Enterprise compliance risk visibility, department scoring, and trend analysis." />
        <ErrorState message={error} onRetry={() => { riskRefetch(); trendsRefetch(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk & Analytics"
        description="Enterprise compliance risk visibility, department scoring, and trend analysis."
      />

      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {isLoading ? (
          <>
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
          </>
        ) : (
          <>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="glass-panel glass-panel-hover rounded-xl p-5 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-emerald-400" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">Avg Score</p>
                <p className="text-2xl font-bold text-emerald-400">{overallScore}%</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="glass-panel glass-panel-hover rounded-xl p-5 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-400" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">Total Overdue</p>
                <p className="text-2xl font-bold text-red-400">{totalOverdue}</p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="glass-panel glass-panel-hover rounded-xl p-5 flex items-center gap-4"
            >
              <div className="w-12 h-12 rounded-xl bg-[#b0c6ff]/10 border border-[#b0c6ff]/30 flex items-center justify-center">
                <Target className="w-6 h-6 text-[#b0c6ff]" />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">Departments</p>
                <p className="text-2xl font-bold text-[#d4e4fa]">{riskScores.length}</p>
              </div>
            </motion.div>
          </>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Compliance Trend */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Compliance Score Trend</h3>
            <div className="flex items-center gap-1.5 text-emerald-400">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium">Live</span>
            </div>
          </div>
          <ChartContainer height={280}>
            {complianceTrends.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[#8c90a1] text-sm">No trend data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={complianceTrends}>
                  <defs>
                    <linearGradient id="analyticsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#4ade80" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#4ade80" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#273647" vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} domain={[75, 100]} />
                  <Tooltip contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }} />
                  <Area type="monotone" dataKey="score" stroke="#4ade80" strokeWidth={2} fill="url(#analyticsGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
        </GlassCard>

        {/* Obligations Resolved */}
        <GlassCard className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Obligations vs Resolved</h3>
          </div>
          <ChartContainer height={280}>
            {complianceTrends.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[#8c90a1] text-sm">No data yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={complianceTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#273647" vertical={false} />
                  <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }} />
                  <Bar dataKey="obligations" fill="#b0c6ff" radius={[4, 4, 0, 0]} barSize={20} opacity={0.6} />
                  <Bar dataKey="resolved" fill="#4ade80" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
        </GlassCard>
      </div>

      {/* Department Heatmap */}
      <GlassCard className="p-6">
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-5">Department Risk Heatmap</h3>
        {riskScores.length === 0 && !isLoading ? (
          <p className="text-sm text-[#8c90a1] text-center py-8">No department risk data yet. Upload documents to generate scores.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {riskScores.map((dept: RiskScore, i: number) => {
              const TrendIcon = trendIcons[dept.trend] ?? Minus;
              const scoreColor = dept.score >= 85 ? "text-emerald-400" : dept.score >= 70 ? "text-amber-400" : "text-red-400";
              const bgColor = dept.score >= 85 ? "bg-emerald-500/5 border-emerald-500/20" : dept.score >= 70 ? "bg-amber-500/5 border-amber-500/20" : "bg-red-500/5 border-red-500/20";

              return (
                <motion.div
                  key={dept.department}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.05 }}
                  className={`rounded-xl p-4 border ${bgColor} hover:scale-[1.02] transition-transform cursor-pointer`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[#d4e4fa]">{dept.department}</span>
                    <TrendIcon className={`w-4 h-4 ${trendColors[dept.trend]}`} />
                  </div>
                  <div className="flex items-end justify-between">
                    <span className={`text-2xl font-bold ${scoreColor}`}>{dept.score}</span>
                    <div className="text-right">
                      {dept.overdueCount > 0 && (
                        <span className="text-[10px] text-red-400 font-medium">
                          {dept.overdueCount} overdue
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 bg-[#273647] rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${dept.score}%` }}
                      transition={{ duration: 0.8, delay: i * 0.05 }}
                      className={`h-full rounded-full ${
                        dept.score >= 85 ? "bg-emerald-400" : dept.score >= 70 ? "bg-amber-400" : "bg-red-400"
                      }`}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

