"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { Download, FileText, BarChart3, ShieldCheck, AlertTriangle, Clock, TrendingUp, Loader2, RefreshCw, Printer } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

const PIE_COLORS = ["#4ade80","#b0c6ff","#fbbf24","#f87171","#a78bfa"];

interface ReportData {
  totalObligations: number; compliant: number; atRisk: number; overdue: number;
  inProgress: number; pendingReview: number; totalDocs: number; processedDocs: number;
  byDepartment: { dept: string; count: number; compliant: number }[];
  byPriority: { priority: string; count: number }[];
  mapStats: {
    ai_generated: number;
    approved: number;
    assigned: number;
    in_progress: number;
    under_review: number;
    completed: number;
    rejected: number;
    escalated: number;
    backlog: number;
  };
  complianceScore: number; generatedAt: string;
}

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? "#4ade80" : score >= 60 ? "#fbbf24" : "#f87171";
  const radius = 52; const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  return (
    <div className="relative flex items-center justify-center w-36 h-36">
      <svg className="absolute inset-0 -rotate-90" width="144" height="144" viewBox="0 0 144 144">
        <circle cx="72" cy="72" r={radius} fill="none" stroke="#273647" strokeWidth="10" />
        <circle cx="72" cy="72" r={radius} fill="none" stroke={color} strokeWidth="10" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="text-center">
        <p className="text-2xl font-bold" style={{ color }}>{score}%</p>
        <p className="text-[10px] text-[#8c90a1] uppercase tracking-wider">Compliance</p>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const api = useTenantApi();
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/reports");
      if (!res.ok) throw new Error("Failed to load report data");
      setData((await res.json()) as ReportData);
    }
    catch { toast.error("Failed to load report data"); }
    finally { setLoading(false); }
  }, [api]);
  useEffect(() => { load(); }, [load]);

  const exportCSV = () => {
    if (!data) return;
    const rows = [
      ["Suraksha Compliance OS — Compliance Report"],
      [`Generated: ${data.generatedAt}`],
      [],
      ["SUMMARY"],
      ["Total Obligations", data.totalObligations],
      ["Compliance Score", `${data.complianceScore}%`],
      ["Compliant", data.compliant],
      ["At Risk", data.atRisk],
      ["Overdue", data.overdue],
      ["In Progress", data.inProgress],
      ["Documents Processed", `${data.processedDocs}/${data.totalDocs}`],
      [],
      ["BY DEPARTMENT","Total","Compliant"],
      ...data.byDepartment.map(d => [d.dept, d.count, d.compliant]),
      [],
      ["MAP BOARD STATS"],
      ["AI generated", data.mapStats.ai_generated],
      ["Approved", data.mapStats.approved],
      ["Assigned", data.mapStats.assigned],
      ["In progress", data.mapStats.in_progress],
      ["Under review", data.mapStats.under_review],
      ["Completed", data.mapStats.completed],
      ["Rejected", data.mapStats.rejected],
      ["Escalated", data.mapStats.escalated],
      ["Legacy backlog", data.mapStats.backlog],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `compliance-report-${new Date().toISOString().split("T")[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported");
  };

  const pieData = data ? [
    { name: "Compliant", value: data.compliant },
    { name: "In Progress", value: data.inProgress },
    { name: "At Risk", value: data.atRisk },
    { name: "Overdue", value: data.overdue },
    { name: "Pending Review", value: data.pendingReview },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Compliance Reports" description="Aggregated compliance posture report with exportable summaries."
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button onClick={exportCSV} disabled={!data} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm disabled:opacity-50">
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <button onClick={() => window.print()} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 transition-colors text-sm font-semibold">
              <Printer className="w-4 h-4" /> Print
            </button>
          </div>
        }
      />
      {loading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-[#b0c6ff]" /></div>
      ) : !data ? null : (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
          <GlassCard className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 flex items-center justify-center">
                <FileText className="w-5 h-5 text-[#b0c6ff]" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-[#d4e4fa]">Compliance Summary Report</h2>
                <p className="text-xs text-[#8c90a1]">Generated: {data.generatedAt}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-[#8c90a1] uppercase tracking-wider mb-0.5">Report Period</p>
              <p className="text-sm text-[#d4e4fa] font-medium">All Time (Live Data)</p>
            </div>
          </GlassCard>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Obligations", value: data.totalObligations, icon: FileText, color: "text-[#b0c6ff]" },
              { label: "Overdue", value: data.overdue, icon: AlertTriangle, color: "text-red-400" },
              { label: "MAPs Completed", value: data.mapStats.completed, icon: ShieldCheck, color: "text-emerald-400" },
              { label: "Docs Processed", value: `${data.processedDocs}/${data.totalDocs}`, icon: TrendingUp, color: "text-amber-400" },
            ].map((kpi, i) => {
              const Icon = kpi.icon;
              return (
                <GlassCard key={i} className="p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#273647]/50 flex items-center justify-center shrink-0">
                    <Icon className={`w-4 h-4 ${kpi.color}`} />
                  </div>
                  <div>
                    <p className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</p>
                    <p className="text-[11px] text-[#8c90a1]">{kpi.label}</p>
                  </div>
                </GlassCard>
              );
            })}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <GlassCard className="p-6 flex flex-col items-center justify-center gap-4">
              <ScoreRing score={data.complianceScore} />
              <div className="w-full space-y-2">
                {[
                  { label: "Compliant", count: data.compliant, color: "#4ade80" },
                  { label: "In Progress", count: data.inProgress, color: "#b0c6ff" },
                  { label: "At Risk", count: data.atRisk, color: "#fbbf24" },
                  { label: "Overdue", count: data.overdue, color: "#f87171" },
                  { label: "Pending Review", count: data.pendingReview, color: "#a78bfa" },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-[#8c90a1]">{item.label}</span>
                    </div>
                    <span className="text-[#d4e4fa] font-medium">{item.count}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4 flex items-center gap-2"><BarChart3 className="w-4 h-4 text-[#b0c6ff]" />Status Distribution</h3>
              {pieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={75} dataKey="value" fontSize={10}>
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0d1c2d", border: "1px solid #424655", borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11, color: "#8c90a1" }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="h-48 flex items-center justify-center text-[#8c90a1] text-sm">No data</div>}
            </GlassCard>
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-[#b0c6ff]" />Compliance action board status</h3>
              <div className="space-y-3">
                {[
                  { label: "AI generated", count: data.mapStats.ai_generated, color: "bg-slate-400" },
                  { label: "Approved", count: data.mapStats.approved, color: "bg-cyan-500/80" },
                  { label: "Assigned", count: data.mapStats.assigned, color: "bg-sky-500/80" },
                  { label: "In progress", count: data.mapStats.in_progress, color: "bg-[#b0c6ff]" },
                  { label: "Under review", count: data.mapStats.under_review, color: "bg-amber-400" },
                  { label: "Completed", count: data.mapStats.completed, color: "bg-emerald-400" },
                  { label: "Rejected", count: data.mapStats.rejected, color: "bg-red-400/80" },
                  { label: "Escalated", count: data.mapStats.escalated, color: "bg-red-600" },
                  { label: "Legacy backlog", count: data.mapStats.backlog, color: "bg-slate-600" },
                ].map(item => {
                  const total = Object.values(data.mapStats).reduce((a, b) => a + b, 0) || 1;
                  const pct = Math.round((item.count / total) * 100);
                  return (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-1 text-xs">
                        <span className="text-[#8c90a1]">{item.label}</span>
                        <span className="text-[#d4e4fa]">{item.count} ({pct}%)</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-[#273647]">
                        <div className={`h-1.5 rounded-full ${item.color} transition-all duration-700`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </div>
          {data.byDepartment.length > 0 && (
            <GlassCard className="p-5">
              <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Obligations by Department</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.byDepartment} margin={{ top: 0, right: 16, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#273647" />
                  <XAxis dataKey="dept" tick={{ fill: "#8c90a1", fontSize: 11 }} />
                  <YAxis tick={{ fill: "#8c90a1", fontSize: 11 }} />
                  <Tooltip contentStyle={{ background: "#0d1c2d", border: "1px solid #424655", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#8c90a1" }} />
                  <Bar dataKey="count" name="Total" fill="#b0c6ff" radius={[4,4,0,0]} />
                  <Bar dataKey="compliant" name="Compliant" fill="#4ade80" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </GlassCard>
          )}
          {data.byDepartment.length > 0 && (
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-white/[0.06]">
                <h3 className="text-sm font-semibold text-[#d4e4fa]">Department Compliance Details</h3>
              </div>
              <div className="divide-y divide-white/[0.04]">
                <div className="grid grid-cols-5 gap-3 px-5 py-2 text-[11px] uppercase tracking-wider text-[#8c90a1] font-semibold bg-[#0d1c2d]/50">
                  <div className="col-span-2">Department</div><div>Total</div><div>Compliant</div><div>Score</div>
                </div>
                {data.byDepartment.map(d => {
                  const score = d.count > 0 ? Math.round((d.compliant / d.count) * 100) : 0;
                  return (
                    <div key={d.dept} className="grid grid-cols-5 gap-3 px-5 py-3 items-center hover:bg-[#273647]/10">
                      <div className="col-span-2 text-sm text-[#d4e4fa] font-medium">{d.dept}</div>
                      <div className="text-sm text-[#8c90a1]">{d.count}</div>
                      <div className="text-sm text-emerald-400">{d.compliant}</div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-[#273647]">
                          <div className="h-1.5 rounded-full bg-emerald-400" style={{ width: `${score}%` }} />
                        </div>
                        <span className="text-xs text-[#d4e4fa] w-8 text-right">{score}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          )}
        </motion.div>
      )}
    </div>
  );
}
