"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { Shield, AlertTriangle, CheckCircle, Search, Filter, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface Finding {
  id: string;
  source: string;
  external_id: string | null;
  title: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "info";
  asset: string | null;
  department: string | null;
  status: "open" | "accepted" | "false_positive" | "resolved";
  first_seen_at: string;
  last_seen_at: string;
  obligation_id: string | null;
}

const SEV_CONFIG = {
  critical: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/30" },
  high:     { color: "text-orange-400", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  medium:   { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/30" },
  low:      { color: "text-yellow-400", bg: "bg-yellow-500/10", border: "border-yellow-500/30" },
  info:     { color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/30" },
};

const SOURCES = ["all", "wazuh", "osquery", "trivy", "gitleaks", "semgrep", "defectdojo", "manual"];
const STATUSES = ["all", "open", "accepted", "false_positive", "resolved"];

export default function SecurityFindingsPage() {
  const api = useTenantApi();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [selectedSeverities, setSelectedSeverities] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api("/api/integrations/security-findings");
      if (!res.ok) {
        if (res.status === 403) { setError("You do not have permission to view security findings."); return; }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      setFindings(Array.isArray(data.findings) ? data.findings : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load findings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = findings.filter(f => {
    if (sourceFilter !== "all" && f.source !== sourceFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    if (selectedSeverities.size > 0 && !selectedSeverities.has(f.severity)) return false;
    if (search && !f.title.toLowerCase().includes(search.toLowerCase()) && !(f.asset ?? "").toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  findings.filter(f => f.status === "open").forEach(f => { if (f.severity in counts) counts[f.severity as keyof typeof counts]++; });

  const toggleSeverity = (s: string) => {
    setSelectedSeverities(prev => {
      const next = new Set(prev);
      next.has(s) ? next.delete(s) : next.add(s);
      return next;
    });
  };

  const handleExportCSV = () => {
    const rows = filtered.map(f => [f.id, f.source, f.severity, f.status, f.title, f.asset ?? "", f.first_seen_at].join(","));
    const blob = new Blob([["id,source,severity,status,title,asset,first_seen", ...rows].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "security_findings.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security Findings"
        description="Vulnerability and compliance findings imported from Wazuh, Trivy, Gitleaks, Semgrep, and DefectDojo."
        actions={
          <div className="flex gap-2">
            <button onClick={load} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 text-sm">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
            <button onClick={handleExportCSV} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 text-sm">
              Export CSV
            </button>
          </div>
        }
      />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {(["critical", "high", "medium", "low", "info"] as const).map(sev => (
          <button key={sev} onClick={() => toggleSeverity(sev)}
            className={cn("rounded-xl border p-4 text-left transition-colors", SEV_CONFIG[sev].bg, SEV_CONFIG[sev].border, selectedSeverities.has(sev) && "ring-2 ring-white/20")}>
            <p className={cn("text-xs uppercase font-semibold tracking-wider", SEV_CONFIG[sev].color)}>{sev}</p>
            <p className="text-2xl font-bold text-[#d4e4fa] mt-1">{counts[sev]}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <GlassCard className="p-4 flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2 flex-1 min-w-48 bg-[#0d1c2d] border border-[#424655]/30 rounded-lg px-3 py-2">
          <Search className="w-4 h-4 text-[#8c90a1] shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search findings…"
            className="bg-transparent text-sm text-[#d4e4fa] placeholder:text-[#8c90a1]/60 outline-none flex-1" />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[#8c90a1]" />
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}
            className="rounded-lg border border-[#424655]/30 bg-[#0d1c2d] px-3 py-2 text-xs text-[#d4e4fa] outline-none">
            {SOURCES.map(s => <option key={s} value={s}>{s === "all" ? "All sources" : s.toUpperCase()}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="rounded-lg border border-[#424655]/30 bg-[#0d1c2d] px-3 py-2 text-xs text-[#d4e4fa] outline-none">
            {STATUSES.map(s => <option key={s} value={s}>{s === "all" ? "All statuses" : s.replace("_", " ")}</option>)}
          </select>
        </div>
        <span className="text-xs text-[#8c90a1]">{filtered.length} of {findings.length} findings</span>
      </GlassCard>

      {/* Findings list */}
      {error && <ErrorState message={error} onRetry={load} />}
      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-[#122131] animate-pulse" />
          ))}
        </div>
      )}
      {!isLoading && !error && filtered.length === 0 && (
        <GlassCard className="p-12 text-center">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-60" />
          <p className="text-[#8c90a1] text-sm">
            {findings.length === 0
              ? "No findings imported yet. POST to /api/integrations/security-findings to import."
              : "No findings match current filters."}
          </p>
        </GlassCard>
      )}
      {!isLoading && !error && filtered.length > 0 && (
        <GlassCard className="p-0 overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {filtered.map((f, i) => {
              const sev = SEV_CONFIG[f.severity] ?? SEV_CONFIG.info;
              return (
                <motion.div key={f.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className="px-5 py-4 hover:bg-[#273647]/20 transition-colors flex items-start gap-4">
                  <div className={cn("mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center shrink-0", sev.bg)}>
                    {f.severity === "critical" || f.severity === "high"
                      ? <AlertTriangle className={cn("w-4 h-4", sev.color)} />
                      : <Shield className={cn("w-4 h-4", sev.color)} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#d4e4fa]">{f.title}</p>
                    <p className="text-xs text-[#8c90a1] mt-0.5">
                      {f.source.toUpperCase()} · {f.asset ?? f.department ?? "—"} · First seen {new Date(f.first_seen_at).toLocaleDateString("en-IN")}
                    </p>
                    {f.description && <p className="text-xs text-[#8c90a1] mt-1 line-clamp-2">{f.description}</p>}
                  </div>
                  <div className="flex flex-col gap-1.5 items-end shrink-0">
                    <StatusBadge status={f.severity} variant={f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "default"} />
                    <StatusBadge status={f.status.replace("_", " ")} variant={f.status === "open" ? "warning" : f.status === "resolved" ? "success" : "default"} />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
