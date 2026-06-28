"use client";

import { useDashboard } from "@/hooks/use-dashboard";
import { useEscalations } from "@/hooks/use-escalations";
import { GlassCard, PageHeader, KPICard } from "@/components/ui/glass-card";
import { KPISkeleton, ErrorState } from "@/components/ui/loading-states";
import { ChartContainer } from "@/components/ui/chart-container";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { AlertTriangle, TrendingUp, Scale, ShieldCheck, GitBranch, FileText } from "lucide-react";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";

/** Must match `useDashboard` KPI `icon` keys */
const iconMap: Record<string, LucideIcon> = { Scale, ShieldCheck, GitBranch, FileText };

export default function ExecutiveDashboardPage() {
  const { kpis, complianceTrends, riskScores, isLoading, error, refetch } = useDashboard();
  const { escalations } = useEscalations(3);

  if (error) return (
    <div className="space-y-6">
      <PageHeader title="Executive Dashboard" description="Board-level compliance posture and regulatory impact." />
      <ErrorState message={error} onRetry={refetch} />
    </div>
  );

  const topRisks = [...(riskScores ?? [])].sort((a, b) => a.score - b.score).slice(0, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description="Board-level compliance posture, readiness trend, and regulatory risk concentration."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />) :
          kpis.map((m, i) => {
            const Icon = iconMap[m.icon];
            return <KPICard key={m.title} title={m.title} value={m.value} change={m.change} changeType={m.changeType} icon={Icon} index={i} />;
          })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Compliance Trend</h3>
          </div>
          <ChartContainer height={200}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={complianceTrends}>
                <defs>
                  <linearGradient id="execGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b0c6ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#b0c6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#273647" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 11 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 11 }} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }} />
                <Area type="monotone" dataKey="score" stroke="#b0c6ff" strokeWidth={2} fill="url(#execGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </GlassCard>

        <GlassCard className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Active Escalations</h3>
          </div>
          <div className="space-y-3">
            {escalations.length === 0 && <p className="text-sm text-[#8c90a1] py-4 text-center">No active escalations</p>}
            {escalations.map((esc, i) => (
              <motion.div key={esc.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }}
                className="flex items-center gap-3 p-3 rounded-lg bg-[#0d1c2d]/50 border border-[#424655]/20">
                <div className={`w-2 h-2 rounded-full shrink-0 ${esc.severity === "critical" ? "bg-red-400 animate-pulse" : esc.severity === "high" ? "bg-amber-400" : "bg-yellow-400"}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#d4e4fa] truncate">{esc.obligations?.title ?? esc.escalated_to}</p>
                  <p className="text-xs text-[#8c90a1]">{esc.obligations?.department ?? "—"} • {esc.severity}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </div>

      {topRisks.length > 0 && (
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Highest-Risk Departments</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {topRisks.map((r) => (
              <div key={r.department} className="rounded-lg bg-[#0d1c2d]/50 border border-[#424655]/20 p-4">
                <p className="text-xs text-[#8c90a1]">{r.department}</p>
                <p className={`text-2xl font-bold mt-1 ${r.score < 50 ? "text-red-400" : r.score < 70 ? "text-amber-400" : "text-emerald-400"}`}>{r.score}%</p>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
