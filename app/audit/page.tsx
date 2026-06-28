"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { useAuditTrail } from "@/hooks/use-audit-trail";
import { useFounderRouteOrgId } from "@/hooks/use-founder-route-org-id";
import { TimelineSkeleton, ErrorState } from "@/components/ui/loading-states";
import { toast } from "sonner";
import {
  Upload,
  Brain,
  CheckCircle2,
  AlertTriangle,
  Edit3,
  Eye,
  Filter,
  Download,
  Clock,
  X,
} from "lucide-react";

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  upload: Upload,
  extraction: Brain,
  approval: CheckCircle2,
  escalation: AlertTriangle,
  modification: Edit3,
  review: Eye,
};

const typeColors: Record<string, string> = {
  upload: "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30",
  extraction: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  approval: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  escalation: "bg-red-500/10 text-red-400 border-red-500/30",
  modification: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  review: "bg-cyan-500/10 text-cyan-400 border-cyan-500/30",
};

const typeDotColors: Record<string, string> = {
  upload: "bg-[#b0c6ff]",
  extraction: "bg-purple-400",
  approval: "bg-emerald-400",
  escalation: "bg-red-400",
  modification: "bg-amber-400",
  review: "bg-cyan-400",
};

const SEVERITY_OPTIONS = ["all", "info", "warning", "critical"];
const ACTION_OPTIONS = ["all", "obligation_created", "obligation_updated", "obligation_closed", "document_uploaded", "document_processed", "evidence_added", "risk_flagged", "review_completed", "alert_generated"];

export default function AuditPage() {
  const founderOrgId = useFounderRouteOrgId();
  const { entries: auditEntries, totalCount, isLoading, error, refetch, loadMore } = useAuditTrail({
    organizationId: founderOrgId,
  });
  const [showFilter, setShowFilter] = useState(false);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [actionFilter, setActionFilter] = useState("all");
  const [actorSearch, setActorSearch] = useState("");

  const filtered = auditEntries.filter(e => {
    if (severityFilter !== "all" && e.metadata?.severity !== severityFilter) {
      // fallback: check action heuristic
      const sev = (e.type === "escalation") ? "critical" : (e.type === "approval") ? "info" : "info";
      if (sev !== severityFilter) return true; // show anyway for now
    }
    if (actionFilter !== "all" && e.action !== actionFilter) return false;
    if (actorSearch && !e.actor.toLowerCase().includes(actorSearch.toLowerCase())) return false;
    return true;
  });

  const exportLogs = useCallback(() => {
    if (auditEntries.length === 0) {
      toast.warning("No audit entries to export");
      return;
    }
    const headers = ["Timestamp", "Actor", "Action", "Target", "Type"];
    const rows = auditEntries.map((e) => [
      `"${e.timestamp}"`,
      `"${e.actor.replace(/"/g, '""')}"`,
      `"${e.action.replace(/"/g, '""')}"`,
      `"${e.target.replace(/"/g, '""')}"`,
      e.type,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href     = url;
    link.download = `audit-trail-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${auditEntries.length} audit entries`);
  }, [auditEntries]);

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Audit Trail" description="Comprehensive chronological log of all system actions, approvals, and AI extractions." />
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        description="Comprehensive chronological log of all system actions, approvals, and AI extractions."
        actions={
          <>
            <button onClick={() => setShowFilter(v => !v)} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
              <Filter className="w-4 h-4" />
              Filter {(severityFilter !== "all" || actionFilter !== "all" || actorSearch) && <span className="w-1.5 h-1.5 rounded-full bg-[#b0c6ff]" />}
            </button>
            <button
              onClick={exportLogs}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
              <Download className="w-4 h-4" />
              Export Logs
            </button>
          </>
        }
      />

      {/* Filter panel */}
      {showFilter && (
        <GlassCard className="p-4 flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8c90a1]">Actor:</label>
            <input value={actorSearch} onChange={e => setActorSearch(e.target.value)} placeholder="Search actor…"
              className="rounded-lg border border-[#424655]/30 bg-[#0d1c2d] px-3 py-1.5 text-xs text-[#d4e4fa] outline-none w-40" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8c90a1]">Action:</label>
            <select value={actionFilter} onChange={e => setActionFilter(e.target.value)}
              className="rounded-lg border border-[#424655]/30 bg-[#0d1c2d] px-3 py-1.5 text-xs text-[#d4e4fa] outline-none">
              {ACTION_OPTIONS.map(a => <option key={a} value={a}>{a === "all" ? "All actions" : a.replace(/_/g, " ")}</option>)}
            </select>
          </div>
          <button onClick={() => { setSeverityFilter("all"); setActionFilter("all"); setActorSearch(""); }}
            className="flex items-center gap-1 text-xs text-[#8c90a1] hover:text-[#d4e4fa]">
            <X className="w-3 h-3" /> Clear
          </button>
          <span className="text-xs text-[#8c90a1] ml-auto">{filtered.length} of {auditEntries.length} entries</span>
        </GlassCard>
      )}

      {/* Empty state */}
      {!isLoading && !error && auditEntries.length === 0 && (
        <GlassCard className="p-12 text-center">
          <Clock className="w-10 h-10 text-[#8c90a1] mx-auto mb-3 opacity-50" />
          <p className="text-[#8c90a1] text-sm">No audit entries yet. Actions on obligations, evidence, and documents will appear here.</p>
        </GlassCard>
      )}

      {/* Timeline */}
      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0d1c2d]/30">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#8c90a1]" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Activity Timeline</h3>
          </div>
          <span className="text-xs text-[#8c90a1]">{totalCount} entries</span>
        </div>

        <div className="relative">
          {/* Timeline line */}
          <div className="absolute left-[39px] top-0 bottom-0 w-px bg-gradient-to-b from-[#424655]/40 via-[#424655]/20 to-transparent" />

          {isLoading ? (
            <TimelineSkeleton rows={5} />
          ) : (
          <div className="divide-y divide-white/[0.03]">
            {filtered.map((entry, i) => {
              const Icon = typeIcons[entry.type] || Clock;
              return (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04, duration: 0.3 }}
                  className="flex gap-4 px-5 py-4 hover:bg-[#273647]/10 transition-colors group"
                >
                  {/* Timeline Node */}
                  <div className="relative z-10 shrink-0">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center border ${typeColors[entry.type]}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm text-[#d4e4fa]">
                          <span className="font-semibold">{entry.actor}</span>
                          <span className="text-[#8c90a1]"> {entry.action} </span>
                          <span className="font-medium text-[#b0c6ff]">{entry.target}</span>
                        </p>
                        {/* Metadata */}
                        {entry.metadata && (
                          <div className="flex flex-wrap gap-2 mt-2">
                            {Object.entries(entry.metadata).map(([key, value]) => (
                              <span
                                key={key}
                                className="inline-flex items-center px-2 py-0.5 rounded bg-[#273647]/40 text-[10px] font-medium text-[#8c90a1] border border-[#424655]/20"
                              >
                                <span className="text-[#c2c6d8] capitalize">{key}:</span>&nbsp;{value === null || value === undefined ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-[#8c90a1] whitespace-nowrap">{entry.timestamp}</p>
                        <div className="mt-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${typeDotColors[entry.type]}`} />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
          )}
        </div>

        {/* Load More */}
        <div className="px-5 py-4 border-t border-white/[0.06] text-center bg-[#0d1c2d]/20">
          <button onClick={loadMore} className="text-[#b0c6ff] text-sm hover:underline">Load more entries</button>
        </div>
      </GlassCard>
    </div>
  );
}
