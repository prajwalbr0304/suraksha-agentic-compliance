"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { GitCompare, Plus, Minus, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, CheckCircle, ArrowRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";

interface Document { id: string; filename: string; uploaded_at: string }
interface DriftChange {
  type: "new" | "removed" | "changed";
  title: string; base_citation: string; new_citation: string;
  department: string; priority_change: { from: string; to: string } | null;
  risk_change?: { from: string; to: string } | null;
  detail: string;
}
interface DriftResult {
  id: string; summary: string; drift_score: number;
  changes: DriftChange[];
  stats: { new: number; removed: number; changed: number; total_base: number; total_new: number };
  base_doc: { filename: string }; new_doc: { filename: string };
}

const CHANGE_STYLE = {
  new:     { bg: "bg-emerald-500/10", border: "border-emerald-500/30", text: "text-emerald-400", icon: Plus,          label: "New Obligation" },
  removed: { bg: "bg-red-500/10",     border: "border-red-500/30",     text: "text-red-400",     icon: Minus,         label: "Removed" },
  changed: { bg: "bg-amber-500/10",   border: "border-amber-500/30",   text: "text-amber-400",   icon: RefreshCw,     label: "Modified" },
};

function DriftScoreRing({ score }: { score: number }) {
  const r = 52; const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 70 ? "#ef4444" : score >= 40 ? "#fbbf24" : "#4ade80";
  return (
    <div className="flex flex-col items-center gap-2">
      <svg width={128} height={128} viewBox="0 0 128 128">
        <circle cx={64} cy={64} r={r} fill="none" stroke="#273647" strokeWidth={12} />
        <circle cx={64} cy={64} r={r} fill="none" stroke={color} strokeWidth={12}
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" transform="rotate(-90 64 64)" />
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill={color} fontSize={22} fontWeight="bold">{score.toFixed(0)}</text>
        <text x="50%" y="68%" textAnchor="middle" dominantBaseline="middle" fill="#8c90a1" fontSize={10}>Drift Score</text>
      </svg>
      <p className="text-xs text-[#8c90a1] text-center">
        {score >= 70 ? "High drift — significant regulatory change" : score >= 40 ? "Moderate drift — review required" : "Low drift — minimal change"}
      </p>
    </div>
  );
}

export default function DriftAnalyzerPage() {
  const api = useTenantApi();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [baseDocId, setBaseDocId] = useState("");
  const [newDocId, setNewDocId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DriftResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "new" | "removed" | "changed">("all");

  useEffect(() => {
    supabase.from("documents").select("id, filename, uploaded_at").eq("status", "processed").order("uploaded_at", { ascending: false })
      .then(({ data }) => setDocuments(data ?? []));
  }, []);

  const runComparison = useCallback(async () => {
    if (!baseDocId || !newDocId) { toast.error("Select both documents"); return; }
    if (baseDocId === newDocId) { toast.error("Select two different documents"); return; }
    setLoading(true); setResult(null);
    try {
      const res = await api("/api/drift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_doc_id: baseDocId, new_doc_id: newDocId }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setResult(data);
      toast.success("Drift analysis complete");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [baseDocId, newDocId]);

  const filteredChanges = result?.changes.filter(c => filter === "all" || c.type === filter) ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulatory Change Analysis"
        description="Compare two regulatory circulars to detect obligation changes, new requirements, and removed directives."
        actions={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <TrendingUp className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-amber-400 font-medium">AI-Powered Diff Engine</span>
          </div>
        }
      />

      {/* Document selector */}
      <GlassCard className="p-6">
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-4">Select Documents to Compare</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-2">Base Circular (Older)</label>
            <select value={baseDocId} onChange={e => setBaseDocId(e.target.value)}
              className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2.5 focus:outline-none focus:border-[#b0c6ff]/40">
              <option value="">— Select document —</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-2">New Circular (Revised)</label>
            <select value={newDocId} onChange={e => setNewDocId(e.target.value)}
              className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2.5 focus:outline-none focus:border-[#b0c6ff]/40">
              <option value="">— Select document —</option>
              {documents.map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={runComparison} disabled={loading || !baseDocId || !newDocId}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm font-semibold">
            {loading ? (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                <RefreshCw className="w-4 h-4" />
              </motion.div>
            ) : <GitCompare className="w-4 h-4" />}
            {loading ? "Analyzing..." : "Run regulatory change analysis"}
          </button>
        </div>
        {documents.length < 2 && (
          <p className="mt-3 text-xs text-amber-400/80">Upload at least 2 processed documents to compare regulatory drift.</p>
        )}
      </GlassCard>

      {/* Results */}
      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">
            {/* Summary row */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <GlassCard className="md:col-span-1 p-5 flex items-center justify-center">
                <DriftScoreRing score={result.drift_score} />
              </GlassCard>
              <GlassCard className="md:col-span-3 p-5">
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <GitCompare className="w-4 h-4 text-[#b0c6ff]" />
                    <h4 className="text-sm font-semibold text-[#d4e4fa]">Comparison Summary</h4>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#8c90a1]">
                    <span className="text-[#d4e4fa] font-medium">{result.base_doc?.filename}</span>
                    <ArrowRight className="w-3 h-3" />
                    <span className="text-[#d4e4fa] font-medium">{result.new_doc?.filename}</span>
                  </div>
                  <p className="text-xs text-[#8c90a1] mt-2 leading-relaxed">{result.summary}</p>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-4">
                  {[
                    { key: "new", label: "New Obligations", count: result.stats.new, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
                    { key: "removed", label: "Removed", count: result.stats.removed, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
                    { key: "changed", label: "Modified", count: result.stats.changed, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20" },
                  ].map(stat => (
                    <button key={stat.key} onClick={() => setFilter(filter === stat.key as typeof filter ? "all" : stat.key as typeof filter)}
                      className={cn("p-3 rounded-xl border text-left transition-all", stat.bg, filter === stat.key ? "ring-1 ring-white/20" : "")}>
                      <div className={cn("text-2xl font-bold", stat.color)}>{stat.count}</div>
                      <div className="text-xs text-[#8c90a1] mt-0.5">{stat.label}</div>
                    </button>
                  ))}
                </div>
              </GlassCard>
            </div>

            {/* Changes list */}
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
                <h4 className="text-sm font-semibold text-[#d4e4fa]">
                  {filter === "all" ? "All Changes" : CHANGE_STYLE[filter]?.label + "s"} ({filteredChanges.length})
                </h4>
                <div className="flex gap-1.5">
                  {(["all","new","removed","changed"] as const).map(f => (
                    <button key={f} onClick={() => setFilter(f)} className={cn("px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors", filter === f ? "bg-[#b0c6ff] text-[#002d6f]" : "text-[#8c90a1] hover:text-[#d4e4fa]")}>{f}</button>
                  ))}
                </div>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {filteredChanges.length === 0 ? (
                  <div className="p-8 text-center text-[#8c90a1] text-sm">No changes in this category.</div>
                ) : filteredChanges.map((change, i) => {
                  const style = CHANGE_STYLE[change.type];
                  const Icon = style.icon;
                  const isOpen = expanded.has(i);
                  return (
                    <div key={i} className={cn("p-4 border-l-2", style.border.replace("border-", "border-l-"))}>
                      <div className="flex items-start justify-between gap-3 cursor-pointer" onClick={() => setExpanded(p => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; })}>
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={cn("flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full mt-0.5", style.bg)}>
                            <Icon className={cn("w-3 h-3", style.text)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={cn("text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full", style.bg, style.text)}>{style.label}</span>
                              {change.department && <span className="text-[10px] text-[#8c90a1] px-2 py-0.5 rounded-full bg-[#273647]/40">{change.department}</span>}
                            </div>
                            <p className="text-sm text-[#d4e4fa] mt-1.5 font-medium leading-snug">{change.title}</p>
                            {(change.base_citation || change.new_citation) && (
                              <div className="flex items-center gap-3 mt-1">
                                {change.base_citation && <span className="text-[10px] text-[#8c90a1]">Base: {change.base_citation}</span>}
                                {change.new_citation && <span className="text-[10px] text-[#8c90a1]">New: {change.new_citation}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                        {isOpen ? <ChevronDown className="w-4 h-4 text-[#8c90a1] flex-shrink-0" /> : <ChevronRight className="w-4 h-4 text-[#8c90a1] flex-shrink-0" />}
                      </div>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                            <div className="mt-3 pl-9 space-y-2">
                              <p className="text-xs text-[#8c90a1] leading-relaxed">{change.detail}</p>
                              {change.priority_change && (
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-[#8c90a1]">Priority:</span>
                                  <span className="text-xs font-semibold text-red-400 capitalize">{change.priority_change.from}</span>
                                  <ArrowRight className="w-3 h-3 text-[#8c90a1]" />
                                  <span className="text-xs font-semibold text-amber-400 capitalize">{change.priority_change.to}</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !loading && (
        <div className="flex flex-col items-center justify-center py-20 text-[#8c90a1] gap-3">
          <GitCompare className="w-12 h-12 opacity-30" />
          <p className="text-sm">Select two circulars and run analysis to detect regulatory drift.</p>
        </div>
      )}
    </div>
  );
}
