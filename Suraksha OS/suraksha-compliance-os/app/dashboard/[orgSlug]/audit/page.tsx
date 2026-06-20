"use client";

import { useDashboard } from "@/hooks/use-dashboard";
import { useAuditTrail } from "@/hooks/use-audit-trail";
import type { AuditEntry } from "@/types";
import { GlassCard, PageHeader, StatusBadge } from "@/components/ui/glass-card";
import { KPISkeleton, TimelineSkeleton, ErrorState } from "@/components/ui/loading-states";
import { ShieldCheck, AlertTriangle, Clock, Download, Scale, GitBranch, FileText } from "lucide-react";
import { motion } from "framer-motion";
import { KPICard } from "@/components/ui/glass-card";
import type { LucideIcon } from "lucide-react";

/** Must match `useDashboard` KPI `icon` keys */
const iconMap: Record<string, LucideIcon> = { Scale, ShieldCheck, GitBranch, FileText };

function severityFromEntry(e: AuditEntry): "critical" | "warning" | "info" {
  if (e.type === "escalation") return "critical";
  if (e.type === "extraction" || e.type === "upload") return "warning";
  return "info";
}

export default function AuditDashboardPage() {
  const { kpis, riskScores, isLoading: dashLoading, error: dashError, refetch } = useDashboard();
  const { entries, isLoading: auditLoading, error: auditError, refetch: refetchAudit } = useAuditTrail();

  const criticalAudit = riskScores.filter(r => r.score < 60);

  const exportCSV = () => {
    const rows = entries.map((e) =>
      [e.id, e.actor, e.action, e.target, severityFromEntry(e), e.timestamp].join(",")
    );
    const csv = ["id,actor,action,target,severity,timestamp", ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "audit_trail.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (dashError) return (
    <div className="space-y-6">
      <PageHeader title="Internal Audit Dashboard" description="Evidence completeness, audit trail, and exceptions." />
      <ErrorState message={dashError} onRetry={refetch} />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Audit Dashboard"
        description="Evidence completeness, immutable audit trail, exceptions, control tests, and audit pack readiness."
        actions={
          <button onClick={exportCSV} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 text-sm">
            <Download className="w-4 h-4" />
            Export Audit Trail
          </button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {dashLoading ? Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />) :
          kpis.map((m, i) => {
            const Icon = iconMap[m.icon];
            return <KPICard key={m.title} title={m.title} value={m.value} change={m.change} changeType={m.changeType} icon={Icon} index={i} />;
          })}
      </div>

      {criticalAudit.length > 0 && (
        <GlassCard className="p-5 border border-red-500/20 bg-red-500/5">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold text-red-300">{criticalAudit.length} Department(s) Below 60% Readiness</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {criticalAudit.map(r => (
              <div key={r.department} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20">
                <span className="text-sm text-red-200">{r.department}</span>
                <span className="text-xs font-bold text-red-400">{r.score}%</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#b0c6ff]" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Audit Trail (last 20)</h3>
          </div>
          <span className="text-xs text-[#8c90a1]">{entries.length} entries loaded</span>
        </div>
        {auditLoading && <div className="p-6"><TimelineSkeleton /></div>}
        {auditError && <ErrorState message={auditError} onRetry={refetchAudit} />}
        {!auditLoading && !auditError && entries.length === 0 && (
          <p className="p-6 text-sm text-center text-[#8c90a1]">No audit entries yet.</p>
        )}
        <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
          {entries.map((entry, i) => {
            const sev = severityFromEntry(entry);
            return (
            <motion.div key={entry.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="px-5 py-3.5 flex items-center gap-4 hover:bg-[#273647]/20">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                sev === "critical" ? "bg-red-500/10 text-red-400" :
                sev === "warning" ? "bg-amber-500/10 text-amber-400" : "bg-[#b0c6ff]/10 text-[#b0c6ff]"
              }`}>
                {sev === "critical" ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#d4e4fa]"><span className="font-medium">{entry.actor}</span> · {entry.action}</p>
                <p className="text-xs text-[#8c90a1] truncate">{entry.target} · {entry.timestamp}</p>
              </div>
              <StatusBadge status={sev} variant={sev === "critical" ? "error" : sev === "warning" ? "warning" : "info"} />
            </motion.div>
          );})}
        </div>
      </GlassCard>
    </div>
  );
}
