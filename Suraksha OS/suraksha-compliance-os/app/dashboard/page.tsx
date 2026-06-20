"use client";

import { motion } from "framer-motion";
import { useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import { getTenantPostLoginRoute } from "@/lib/auth/tenant-routes";
import { KPICard, PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { useDashboard } from "@/hooks/use-dashboard";
import { usePrincipal } from "@/hooks/use-principal";
import { useEscalations } from "@/hooks/use-escalations";
import { KPISkeleton, TimelineSkeleton, ErrorState } from "@/components/ui/loading-states";
import { ChartContainer } from "@/components/ui/chart-container";
import { Scale, ShieldCheck, GitBranch, FileText, TrendingUp, ArrowUpRight, AlertTriangle, Clock, type LucideIcon } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell,
} from "recharts";

const iconMap: Record<string, LucideIcon> = {
  Scale, ShieldCheck, GitBranch, FileText,
};

export default function DashboardPage() {
  const router = useRouter();
  const { principal, isLoading: principalLoading, error: principalError, refetch: refetchPrincipal } = usePrincipal();
  const { kpis, recentActivity, riskScores, complianceTrends, isLoading, error, refetch } = useDashboard();
  const { escalations } = useEscalations(5);

  const redirectTarget = principal ? getTenantPostLoginRoute(principal) : null;
  const showWorkspaceLoader =
    principalLoading || (!!principal && redirectTarget !== "/dashboard");

  useLayoutEffect(() => {
    if (!principal) return;
    const next = getTenantPostLoginRoute(principal);
    if (next !== "/dashboard") router.replace(next);
  }, [principal, router]);

  if (!principalLoading && principalError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Executive Dashboard" description="Real-time compliance posture and AI risk analysis." />
        <ErrorState message={principalError} onRetry={() => void refetchPrincipal()} />
      </div>
    );
  }

  if (showWorkspaceLoader && !error) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="rounded-xl border border-white/[0.08] bg-[#122131]/80 px-6 py-4 text-sm text-[#d4e4fa]">
          Loading workspace…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Executive Dashboard" description="Real-time compliance posture and AI risk analysis." />
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Executive Dashboard"
        description="Real-time compliance posture and AI risk analysis."
        actions={
          <>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
              <ArrowUpRight className="w-4 h-4" />
              Export Report
            </button>
            <button className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 transition-colors text-sm font-medium glow-primary">
              + New Assessment
            </button>
          </>
        }
      />

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {isLoading ? (
          <>
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
            <KPISkeleton />
          </>
        ) : (
          kpis.map((metric, i) => {
            const Icon = iconMap[metric.icon];
            return (
              <KPICard
                key={metric.title}
                title={metric.title}
                value={metric.value}
                change={metric.change}
                changeType={metric.changeType}
                icon={Icon}
                index={i}
              />
            );
          })
        )}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Compliance Trend */}
        <GlassCard className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-[#d4e4fa]">Compliance Trend</h3>
              <p className="text-xs text-[#8c90a1] mt-0.5">6-month compliance score progression</p>
            </div>
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs font-medium text-emerald-400">+12%</span>
            </div>
          </div>
          <ChartContainer height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={complianceTrends}>
                <defs>
                  <linearGradient id="complianceGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b0c6ff" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#b0c6ff" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#273647" vertical={false} />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 12 }} domain={[75, 100]} />
                <Tooltip
                  contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }}
                  labelStyle={{ color: "#8c90a1" }}
                />
                <Area type="monotone" dataKey="score" stroke="#b0c6ff" strokeWidth={2} fill="url(#complianceGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </GlassCard>

        {/* Department Risk */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Department Risk Scores</h3>
          <ChartContainer height={240}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskScores} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#273647" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 11 }} />
                <YAxis dataKey="department" type="category" axisLine={false} tickLine={false} tick={{ fill: "#8c90a1", fontSize: 11 }} width={100} />
                <Tooltip
                  contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }}
                />
                <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={16}>
                  {riskScores.map((entry) => (
                    <Cell
                      key={entry.department}
                      fill={entry.score >= 85 ? "#4ade80" : entry.score >= 70 ? "#fbbf24" : "#f87171"}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartContainer>
        </GlassCard>
      </div>

      {/* Activity & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Activity */}
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Recent Activity</h3>
            <button className="text-xs text-[#b0c6ff] hover:underline">View All</button>
          </div>
          <div className="divide-y divide-white/[0.04]">
            {recentActivity.map((item, i) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="px-5 py-3.5 hover:bg-[#273647]/20 transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                    item.type === "upload" ? "bg-[#b0c6ff]/10 text-[#b0c6ff]" :
                    item.type === "extraction" ? "bg-purple-500/10 text-purple-400" :
                    item.type === "approval" ? "bg-emerald-500/10 text-emerald-400" :
                    item.type === "escalation" ? "bg-red-500/10 text-red-400" :
                    "bg-amber-500/10 text-amber-400"
                  }`}>
                    {item.type === "escalation" ? <AlertTriangle className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-[#d4e4fa]">
                      <span className="font-medium">{item.actor}</span>{" "}
                      <span className="text-[#8c90a1]">{item.action}</span>{" "}
                      <span className="font-medium text-[#b0c6ff]">{item.target}</span>
                    </p>
                    <p className="text-xs text-[#8c90a1] mt-0.5">{item.timestamp}</p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>

        {/* Live Escalations */}
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Escalations & Alerts</h3>
            <StatusBadge status={`${escalations.length} Active`} variant={escalations.length > 0 ? "error" : "default"} />
          </div>
          <div className="p-5 space-y-3">
            {escalations.length === 0 && (
              <p className="text-sm text-[#8c90a1] text-center py-4">No active escalations</p>
            )}
            {escalations.map((esc, i) => (
              <motion.div
                key={esc.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="flex items-center gap-4 p-3 rounded-lg bg-[#0d1c2d]/50 border border-[#424655]/20 hover:border-red-500/30 transition-colors"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  esc.severity === "critical" ? "bg-red-400 animate-pulse" :
                  esc.severity === "high" ? "bg-amber-400" : "bg-yellow-400"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#d4e4fa] truncate">
                    {esc.obligations?.title ?? esc.map_cards?.title ?? esc.escalated_to}
                  </p>
                  <p className="text-xs text-[#8c90a1]">
                    {esc.obligations?.department ?? "—"} • {esc.reason ?? esc.severity}
                  </p>
                </div>
                <StatusBadge 
                  status={esc.severity} 
                  variant={esc.severity === "critical" ? "error" : esc.severity === "high" ? "warning" : "default"} 
                />
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
