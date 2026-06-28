"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { Zap, Building2, Clock, AlertTriangle, BarChart3, RefreshCw, Play, DollarSign, ShieldAlert, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";

interface Document { id: string; filename: string; uploaded_at: string; status: string }
interface ImpactedTeam { department: string; obligation_count: number; estimated_hours: number }
interface SimResult {
  id: string; summary: string;
  impacted_teams: ImpactedTeam[];
  engineering_effort: number; estimated_weeks: number;
  risk_level: string; audit_risk: string; operational_risk: string; complexity: string;
  affected_controls: string[];
  total_obligations: number; critical_count: number;
  budget_estimate: number;
}
interface PastSim {
  id: string; created_at: string; regulation_name: string; risk_level: string;
  engineering_effort: number; estimated_weeks: number;
  documents: { filename: string };
}

const RISK_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  critical: { color: "#ef4444", bg: "#ef444420", label: "Critical" },
  high:     { color: "#f97316", bg: "#f9731620", label: "High" },
  medium:   { color: "#fbbf24", bg: "#fbbf2420", label: "Moderate" },
  low:      { color: "#4ade80", bg: "#4ade8020", label: "Low" },
};

export default function ImpactSimulationPage() {
  const api = useTenantApi();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [pastSims, setPastSims] = useState<PastSim[]>([]);
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    supabase.from("documents").select("id, filename, uploaded_at, status").eq("status", "processed")
      .order("uploaded_at", { ascending: false })
      .then(({ data }) => setDocuments(data ?? []));

    api("/api/impact").then(r => r.json()).then(data => setPastSims(data ?? []));
  }, []);

  const runSimulation = useCallback(async () => {
    if (!selectedDocId) { toast.error("Select a document"); return; }
    setLoading(true); setResult(null);
    try {
      const res = await api("/api/impact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: selectedDocId }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      toast.success("Impact simulation complete");
      api("/api/impact").then(r => r.json()).then(d => setPastSims(d ?? []));
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [selectedDocId]);

  const formatCurrency = (n: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Impact Analysis"
        description="AI predicts implementation effort, risk exposure, and remediation timeline when a new circular arrives."
        actions={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20">
            <Zap className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-purple-400 font-medium">AI Impact Engine</span>
          </div>
        }
      />

      {/* Simulator */}
      <GlassCard className="p-6">
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Run compliance impact analysis</h3>
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-2">Select Circular / Document</label>
            <select value={selectedDocId} onChange={e => setSelectedDocId(e.target.value)}
              className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2.5 focus:outline-none focus:border-[#b0c6ff]/40">
              <option value="">— Select processed document —</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select>
          </div>
          <button onClick={runSimulation} disabled={loading || !selectedDocId}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-500 text-white hover:bg-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm font-semibold">
            {loading ? <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}><RefreshCw className="w-4 h-4" /></motion.div> : <Play className="w-4 h-4" />}
            {loading ? "Simulating..." : "Run Simulation"}
          </button>
        </div>
        {documents.length === 0 && (
          <p className="mt-3 text-xs text-amber-400/80">Upload and process a regulatory document to run impact simulation.</p>
        )}
      </GlassCard>

      {/* Result */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">
            {/* Summary bar */}
            <GlassCard className="p-5 border border-purple-500/20">
              <div className="flex items-start gap-3 mb-4">
                <Zap className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-sm font-semibold text-[#d4e4fa]">Simulation Summary</h4>
                  <p className="text-xs text-[#8c90a1] mt-1.5 leading-relaxed">{result.summary}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: "Overall Risk", val: RISK_CONFIG[result.risk_level]?.label, color: RISK_CONFIG[result.risk_level]?.color, icon: AlertTriangle },
                  { label: "Eng. Effort", val: `${result.engineering_effort}h`, color: "#b0c6ff", icon: BarChart3 },
                  { label: "Timeline", val: `${result.estimated_weeks} weeks`, color: "#2dd4bf", icon: Clock },
                  { label: "Budget Est.", val: formatCurrency(result.budget_estimate), color: "#4ade80", icon: DollarSign },
                ].map(m => {
                  const Icon = m.icon;
                  return (
                    <div key={m.label} className="rounded-xl bg-[#0d1c2d] p-3">
                      <Icon className="w-4 h-4 mb-2" style={{ color: m.color }} />
                      <div className="text-base font-bold" style={{ color: m.color }}>{m.val}</div>
                      <p className="text-[10px] text-[#8c90a1] mt-0.5">{m.label}</p>
                    </div>
                  );
                })}
              </div>
            </GlassCard>

            {/* Risk cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: "Regulatory Risk", level: result.risk_level, icon: ShieldAlert, desc: "Likelihood of regulatory penalty if unaddressed" },
                { label: "Audit Risk", level: result.audit_risk, icon: BarChart3, desc: "Risk of adverse findings during RBI inspection" },
                { label: "Operational Risk", level: result.operational_risk, icon: AlertTriangle, desc: "Disruption risk to ongoing banking operations" },
              ].map(r => {
                const cfg = RISK_CONFIG[r.level] ?? RISK_CONFIG.medium;
                const Icon = r.icon;
                return (
                  <GlassCard key={r.label} className="p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                      <h5 className="text-xs font-semibold text-[#d4e4fa]">{r.label}</h5>
                    </div>
                    <div className="text-2xl font-bold mb-1" style={{ color: cfg.color }}>{cfg.label}</div>
                    <p className="text-[10px] text-[#8c90a1] leading-relaxed">{r.desc}</p>
                  </GlassCard>
                );
              })}
            </div>

            {/* Impacted teams */}
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06]">
                <h4 className="text-sm font-semibold text-[#d4e4fa]">Impacted Teams ({result.impacted_teams?.length ?? 0})</h4>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {(result.impacted_teams ?? []).map((team, i) => (
                  <motion.div key={team.department} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.07 }}
                    className="px-5 py-3.5 flex items-center gap-4">
                    <Building2 className="w-4 h-4 text-[#8c90a1] flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-[#d4e4fa]">{team.department}</p>
                      <p className="text-xs text-[#8c90a1]">{team.obligation_count} obligation{team.obligation_count !== 1 ? "s" : ""}</p>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-[#b0c6ff]">{team.estimated_hours}h</div>
                      <div className="text-[10px] text-[#8c90a1]">estimated effort</div>
                    </div>
                    <div className="w-24 h-1.5 rounded-full bg-[#273647] overflow-hidden">
                      <div className="h-full rounded-full bg-[#b0c6ff]" style={{ width: `${Math.min(100, (team.estimated_hours / result.engineering_effort) * 100)}%` }} />
                    </div>
                  </motion.div>
                ))}
              </div>
            </GlassCard>

            {/* Affected controls */}
            {result.affected_controls?.length > 0 && (
              <GlassCard className="p-5">
                <h4 className="text-sm font-semibold text-[#d4e4fa] mb-3">Affected Compliance Controls</h4>
                <div className="flex flex-wrap gap-2">
                  {result.affected_controls.map((ctrl, i) => (
                    <span key={i} className="px-3 py-1.5 rounded-full bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 text-[#b0c6ff] text-xs font-medium">{ctrl}</span>
                  ))}
                </div>
              </GlassCard>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Past simulations */}
      {pastSims.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <button className="w-full px-5 py-4 border-b border-white/[0.06] flex items-center justify-between"
            onClick={() => setShowPast(p => !p)}>
            <h4 className="text-sm font-semibold text-[#d4e4fa]">Past Simulations ({pastSims.length})</h4>
            {showPast ? <ChevronDown className="w-4 h-4 text-[#8c90a1]" /> : <ChevronRight className="w-4 h-4 text-[#8c90a1]" />}
          </button>
          <AnimatePresence>
            {showPast && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="divide-y divide-white/[0.04]">
                  {pastSims.map(sim => {
                    const cfg = RISK_CONFIG[sim.risk_level] ?? RISK_CONFIG.medium;
                    return (
                      <div key={sim.id} className="px-5 py-3.5 flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#d4e4fa] truncate">{sim.regulation_name || sim.documents?.filename || "Unknown"}</p>
                          <p className="text-xs text-[#8c90a1]">{new Date(sim.created_at).toLocaleDateString("en-IN")}</p>
                        </div>
                        <span className="text-xs font-semibold px-2.5 py-1 rounded-full" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label} Risk</span>
                        <span className="text-xs text-[#8c90a1]">{sim.engineering_effort}h · {sim.estimated_weeks}w</span>
                      </div>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      )}

      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-16 text-[#8c90a1] gap-3">
          <Zap className="w-12 h-12 opacity-30" />
          <p className="text-sm">Select a circular and run simulation to predict compliance impact.</p>
        </div>
      )}
    </div>
  );
}
