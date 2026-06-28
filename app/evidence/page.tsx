"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { ShieldCheck, Plus, Check, Clock, Filter, RefreshCw, FileText, Sparkles, ChevronDown, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";

interface EvidenceItem {
  id: string; title: string; description: string; collected_at: string | null; created_at: string;
  obligation_id: string;
  obligations: { id: string; title: string; department: string; priority: string; status: string; regulation: string };
}
interface EvidenceGroup {
  obligation_id: string;
  obligation_title: string;
  department: string;
  priority: string;
  regulation: string;
  items: EvidenceItem[];
  collected: number;
  total: number;
}

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444", high: "#f97316", medium: "#fbbf24", low: "#4ade80",
};

const DEPT_OPTIONS = ["all", "Compliance", "IT", "Risk Management", "Finance", "Operations", "Legal", "Internal Audit", "Fraud & AML"];

function EvidenceIntelligenceInner() {
  const api = useTenantApi();
  const searchParams = useSearchParams();
  const obligationFocus = searchParams.get("obligation_id");
  const [groups, setGroups] = useState<EvidenceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "collected">("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const fetchEvidence = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (deptFilter !== "all") params.set("department", deptFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await api(`/api/evidence-intelligence?${params}`);
      const data: EvidenceItem[] = await res.json();

      // Group by obligation
      const map: Record<string, EvidenceGroup> = {};
      data.forEach(ev => {
        const obl = ev.obligations;
        if (!map[ev.obligation_id]) {
          map[ev.obligation_id] = {
            obligation_id: ev.obligation_id,
            obligation_title: obl?.title ?? "",
            department: obl?.department ?? "",
            priority: obl?.priority ?? "medium",
            regulation: obl?.regulation ?? "",
            items: [],
            collected: 0,
            total: 0,
          };
        }
        map[ev.obligation_id].items.push(ev);
        map[ev.obligation_id].total++;
        if (ev.collected_at) map[ev.obligation_id].collected++;
      });

      setGroups(Object.values(map));
    } catch {
      toast.error("Failed to load evidence");
    } finally {
      setLoading(false);
    }
  }, [deptFilter, statusFilter]);

  useEffect(() => { fetchEvidence(); }, [fetchEvidence]);

  useEffect(() => {
    if (!obligationFocus || loading || groups.length === 0) return;
    const match = groups.some((g) => g.obligation_id === obligationFocus);
    if (!match) return;
    setExpanded((prev) => new Set(prev).add(obligationFocus));
    const t = window.setTimeout(() => {
      document.getElementById(`obligation-ev-${obligationFocus}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);
    return () => window.clearTimeout(t);
  }, [obligationFocus, loading, groups]);

  const toggleCollected = async (evidenceId: string, currentlyCollected: boolean) => {
    try {
      const res = await api(`/api/evidence?id=${evidenceId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collected: !currentlyCollected }),
      });
      if (!res.ok) throw new Error("Update failed");
      toast.success(currentlyCollected ? "Marked as pending" : "Evidence marked as collected");
      fetchEvidence();
    } catch {
      toast.error("Failed to update evidence");
    }
  };

  const aiRecommend = async (group: EvidenceGroup) => {
    setAiLoading(group.obligation_id);
    try {
      const res = await api("/api/evidence-intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          obligation_id: group.obligation_id,
          obligation_title: group.obligation_title,
          department: group.department,
          regulation: group.regulation,
        }),
      });
      const data = await res.json();
      toast.success(`Added ${data.inserted} AI-recommended evidence items`);
      fetchEvidence();
    } catch {
      toast.error("AI recommendation failed");
    } finally {
      setAiLoading(null);
    }
  };

  const filtered = groups.filter(g =>
    (search === "" || g.obligation_title.toLowerCase().includes(search.toLowerCase()) || g.department.toLowerCase().includes(search.toLowerCase()))
  );

  const totalItems = groups.reduce((a, g) => a + g.total, 0);
  const collectedItems = groups.reduce((a, g) => a + g.collected, 0);
  const completionPct = totalItems === 0 ? 0 : Math.round((collectedItems / totalItems) * 100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Evidence Intelligence"
        description="AI-recommended evidence requirements for every obligation with collection tracking and audit readiness."
        actions={
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#b0c6ff]/10 border border-[#b0c6ff]/20">
            <Sparkles className="w-4 h-4 text-[#b0c6ff]" />
            <span className="text-xs text-[#b0c6ff] font-medium">AI Evidence Recommendations</span>
          </div>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Evidence Items", val: totalItems, color: "#b0c6ff" },
          { label: "Collected", val: collectedItems, color: "#4ade80" },
          { label: "Pending", val: totalItems - collectedItems, color: "#fbbf24" },
          { label: "Collection Rate", val: `${completionPct}%`, color: completionPct >= 80 ? "#4ade80" : completionPct >= 60 ? "#fbbf24" : "#ef4444" },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07 }}>
            <GlassCard className="p-4">
              <div className="text-2xl font-bold" style={{ color: s.color }}>{s.val}</div>
              <p className="text-xs text-[#8c90a1] mt-1">{s.label}</p>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c90a1]" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search obligations..." className="pl-9 bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
          </div>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 focus:outline-none">
            {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d === "all" ? "All Departments" : d}</option>)}
          </select>
          <div className="flex gap-1 rounded-lg bg-[#0d1c2d] border border-[#424655]/30 p-1">
            {(["all","pending","collected"] as const).map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-3 py-1.5 rounded-md text-xs font-medium capitalize transition-colors", statusFilter === s ? "bg-[#b0c6ff] text-[#002d6f]" : "text-[#8c90a1] hover:text-[#d4e4fa]")}>{s}</button>
            ))}
          </div>
          <button onClick={fetchEvidence} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>
      </GlassCard>

      {/* Evidence groups */}
      <div className="space-y-3">
        {loading ? (
          [...Array(4)].map((_, i) => <GlassCard key={i} className="p-5 h-24 animate-pulse"><div /></GlassCard>)
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-[#8c90a1] gap-3">
            <FileText className="w-12 h-12 opacity-30" />
            <p className="text-sm">No evidence items found. Try adjusting filters or add evidence to obligations.</p>
          </div>
        ) : filtered.map((group) => {
          const isOpen = expanded.has(group.obligation_id);
          const pct = group.total === 0 ? 0 : Math.round((group.collected / group.total) * 100);
          const pColor = group.priority ? PRIORITY_COLOR[group.priority] : "#fbbf24";

          return (
            <GlassCard key={group.obligation_id} id={`obligation-ev-${group.obligation_id}`} className="p-0 overflow-hidden scroll-mt-24">
              <div className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                onClick={() => setExpanded(p => { const n = new Set(p); n.has(group.obligation_id) ? n.delete(group.obligation_id) : n.add(group.obligation_id); return n; })}>
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ color: pColor, background: pColor + "20" }}>{group.priority}</span>
                      <span className="text-xs text-[#8c90a1]">{group.department}</span>
                      {group.regulation && <span className="text-xs text-[#8c90a1] truncate max-w-[200px]">{group.regulation}</span>}
                    </div>
                    <p className="text-sm font-medium text-[#d4e4fa] leading-snug">{group.obligation_title}</p>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-right">
                      <div className="text-xs text-[#8c90a1]">{group.collected}/{group.total} collected</div>
                      <div className="w-20 h-1.5 rounded-full bg-[#273647] mt-1 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 80 ? "#4ade80" : pct >= 50 ? "#fbbf24" : "#ef4444" }} />
                      </div>
                    </div>
                    {isOpen ? <ChevronDown className="w-4 h-4 text-[#8c90a1]" /> : <ChevronRight className="w-4 h-4 text-[#8c90a1]" />}
                  </div>
                </div>
              </div>

              <AnimatePresence>
                {isOpen && (
                  <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="border-t border-white/[0.06] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider">Evidence Checklist</h5>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void aiRecommend(group);
                          }}
                          disabled={aiLoading === group.obligation_id}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 text-[#b0c6ff] text-xs hover:bg-[#b0c6ff]/20 transition-colors disabled:opacity-50"
                        >
                          {aiLoading === group.obligation_id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                          AI Recommend
                        </button>
                      </div>
                      <div className="space-y-2">
                        {group.items.map(ev => (
                          <div key={ev.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#0d1c2d] group">
                            <button onClick={() => toggleCollected(ev.id, !!ev.collected_at)}
                              className={cn("flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all", ev.collected_at ? "bg-emerald-500/20 border-emerald-500" : "border-[#424655]/50 hover:border-[#b0c6ff]/50")}>
                              {ev.collected_at && <Check className="w-3 h-3 text-emerald-400" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className={cn("text-xs font-medium", ev.collected_at ? "text-emerald-400 line-through" : "text-[#d4e4fa]")}>{ev.title}</p>
                              {ev.description && <p className="text-[10px] text-[#8c90a1] mt-0.5 leading-relaxed">{ev.description}</p>}
                            </div>
                            <div className={cn("flex-shrink-0 flex items-center gap-1 text-[10px]", ev.collected_at ? "text-emerald-400" : "text-amber-400")}>
                              {ev.collected_at ? <Check className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                              {ev.collected_at ? "Collected" : "Pending"}
                            </div>
                          </div>
                        ))}
                        {group.items.length === 0 && (
                          <div className="text-center py-4 text-[#8c90a1] text-xs">
                            No evidence items yet. Click "AI Recommend" to generate requirements.
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}

export default function EvidenceIntelligencePage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <PageHeader title="Evidence Intelligence" description="Loading…" />
          <div className="h-40 rounded-xl bg-[#051424]/40 border border-[#424655]/20 animate-pulse" />
        </div>
      }
    >
      <EvidenceIntelligenceInner />
    </Suspense>
  );
}
