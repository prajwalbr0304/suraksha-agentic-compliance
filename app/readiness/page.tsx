"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart-container";
import { RefreshCw, ShieldCheck, AlertTriangle, TrendingUp, TrendingDown, Building2, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";

interface ReadinessScore {
  id: string; department: string; score: number; max_score: number;
  status: "healthy" | "warning" | "at_risk" | "critical";
  total_obligations: number; compliant_count: number; overdue_count: number;
  missing_evidence: number; audit_gaps: number;
  recommendations: string[] | string;
  computed_at: string;
}

const STATUS_CONFIG = {
  healthy:  { color: "#4ade80", bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400",  icon: CheckCircle,  label: "Healthy" },
  warning:  { color: "#fbbf24", bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   icon: AlertCircle,  label: "Warning" },
  at_risk:  { color: "#f97316", bg: "bg-orange-500/10",  border: "border-orange-500/30",  text: "text-orange-400",  icon: AlertTriangle,label: "At Risk" },
  critical: { color: "#ef4444", bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-400",     icon: XCircle,      label: "Critical" },
};

function ScoreCard({ dept, index }: { dept: ReadinessScore; index: number }) {
  const cfg = STATUS_CONFIG[dept.status] ?? STATUS_CONFIG.warning;
  const Icon = cfg.icon;
  const recs = Array.isArray(dept.recommendations)
    ? dept.recommendations
    : typeof dept.recommendations === "string"
      ? JSON.parse(dept.recommendations || "[]")
      : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
    >
      <GlassCard className={cn("p-5 border-l-2", cfg.border.replace("border-", "border-l-"))}>
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#8c90a1]" />
            <h4 className="text-sm font-semibold text-[#d4e4fa]">{dept.department}</h4>
          </div>
          <div className={cn("flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-semibold uppercase tracking-wide", cfg.bg, cfg.text)}>
            <Icon className="w-3 h-3" />
            {cfg.label}
          </div>
        </div>

        {/* Score bar */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs text-[#8c90a1]">Readiness Score</span>
            <span className="text-xl font-bold" style={{ color: cfg.color }}>{dept.score}<span className="text-xs text-[#8c90a1] font-normal">/100</span></span>
          </div>
          <div className="h-2 rounded-full bg-[#273647] overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${dept.score}%` }}
              transition={{ duration: 0.8, delay: index * 0.06 + 0.2, ease: "easeOut" }}
              className="h-full rounded-full"
              style={{ background: cfg.color }}
            />
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {[
            { label: "Total Obligations", val: dept.total_obligations, icon: "📋" },
            { label: "Compliant", val: dept.compliant_count, icon: "✅" },
            { label: "Overdue", val: dept.overdue_count, icon: "⏰" },
            { label: "Missing Evidence", val: dept.missing_evidence, icon: "📂" },
          ].map(s => (
            <div key={s.label} className="rounded-lg bg-[#0d1c2d] p-2.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{s.icon}</span>
                <span className="text-lg font-bold text-[#d4e4fa]">{s.val}</span>
              </div>
              <p className="text-[10px] text-[#8c90a1] mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Recommendations */}
        {recs.length > 0 && (
          <div>
            <p className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider mb-2">AI Recommendations</p>
            <div className="space-y-1.5">
              {recs.slice(0, 3).map((rec: string, i: number) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: cfg.color }} />
                  <p className="text-xs text-[#8c90a1] leading-relaxed">{rec}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}

export default function ReadinessPage() {
  const api = useTenantApi();
  const [scores, setScores] = useState<ReadinessScore[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchScores = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/readiness");
      const data = await res.json();
      setScores(Array.isArray(data) ? data : []);
    } catch {
      toast.error("Failed to load readiness scores");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchScores(); }, [fetchScores]);

  const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, s) => a + s.score, 0) / scores.length) : 0;
  const healthy = scores.filter(s => s.status === "healthy").length;
  const critical = scores.filter(s => s.status === "critical").length;

  // Radar data
  const radarData = scores.slice(0, 8).map(s => ({ dept: s.department.slice(0, 10), score: s.score }));

  // Bar data
  const barData = [...scores].sort((a, b) => b.score - a.score);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Readiness Scoring"
        description="AI-computed departmental readiness scores based on obligations, evidence, and audit gaps."
        actions={
          <button onClick={fetchScores} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} /> Recompute
          </button>
        }
      />

      {/* Overall metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Overall Readiness", val: `${overallScore}%`, icon: ShieldCheck, color: overallScore >= 80 ? "#4ade80" : overallScore >= 65 ? "#fbbf24" : "#ef4444", trend: "↑ from last month" },
          { label: "Healthy Departments", val: healthy, icon: TrendingUp, color: "#4ade80", trend: `of ${scores.length} total` },
          { label: "Critical Departments", val: critical, icon: TrendingDown, color: "#ef4444", trend: "require immediate action" },
          { label: "Departments Assessed", val: scores.length, icon: Building2, color: "#b0c6ff", trend: "across the bank" },
        ].map((m, i) => {
          const Icon = m.icon;
          return (
            <motion.div key={m.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}>
              <GlassCard className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <Icon className="w-5 h-5" style={{ color: m.color }} />
                </div>
                <div className="text-2xl font-bold" style={{ color: m.color }}>{m.val}</div>
                <p className="text-xs font-semibold text-[#d4e4fa] mt-1">{m.label}</p>
                <p className="text-[10px] text-[#8c90a1] mt-0.5">{m.trend}</p>
              </GlassCard>
            </motion.div>
          );
        })}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Radar chart */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Department Readiness Radar</h3>
          <ChartContainer height={280}>
            {loading ? (
              <div className="h-full flex items-center justify-center text-[#8c90a1] text-sm">Loading...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="#273647" />
                  <PolarAngleAxis dataKey="dept" tick={{ fill: "#8c90a1", fontSize: 11 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: "#8c90a1", fontSize: 9 }} />
                  <Radar name="Score" dataKey="score" stroke="#b0c6ff" fill="#b0c6ff" fillOpacity={0.2} strokeWidth={2} />
                </RadarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
        </GlassCard>

        {/* Bar chart */}
        <GlassCard className="p-6">
          <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Score by Department</h3>
          <ChartContainer height={280}>
            {loading ? (
              <div className="h-full flex items-center justify-center text-[#8c90a1] text-sm">Loading...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} layout="vertical" margin={{ left: 8, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#273647" horizontal={false} />
                  <XAxis type="number" domain={[0, 100]} tick={{ fill: "#8c90a1", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="department" tick={{ fill: "#8c90a1", fontSize: 11 }} axisLine={false} tickLine={false} width={110} />
                  <Tooltip contentStyle={{ background: "#122131", border: "1px solid #424655", borderRadius: "8px", color: "#d4e4fa" }} />
                  <Bar dataKey="score" radius={[0, 4, 4, 0]} barSize={14}>
                    {barData.map((entry) => {
                      const color = entry.status === "healthy" ? "#4ade80" : entry.status === "warning" ? "#fbbf24" : entry.status === "at_risk" ? "#f97316" : "#ef4444";
                      return <Cell key={entry.department} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartContainer>
        </GlassCard>
      </div>

      {/* Department cards */}
      <div>
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Department Detail Cards</h3>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <GlassCard key={i} className="p-5 h-48 animate-pulse"><div /></GlassCard>)}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {scores.map((dept, i) => <ScoreCard key={dept.department} dept={dept} index={i} />)}
          </div>
        )}
      </div>
    </div>
  );
}
