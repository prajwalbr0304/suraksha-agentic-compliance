"use client";

import { useEffect, useState } from "react";
import { GlassCard, PageHeader, StatusBadge } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { authFetch } from "@/lib/auth/client";
import { Shield, AlertTriangle, Search, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { useDashboard } from "@/hooks/use-dashboard";
import { KPICard } from "@/components/ui/glass-card";
import { KPISkeleton } from "@/components/ui/loading-states";
import { Scale, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";

const iconMap: Record<string, LucideIcon> = { Scale, ShieldCheck };

interface Finding {
  id: string;
  source: string;
  title: string;
  severity: string;
  department: string | null;
  status: string;
  first_seen_at: string;
  asset: string | null;
}

export default function SecurityDashboardPage() {
  const { kpis, riskScores, isLoading: dashLoading, error: dashError, refetch } = useDashboard();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authFetch("/api/integrations/security-findings")
      .then(r => r.json())
      .then(data => setFindings(Array.isArray(data.findings) ? data.findings : []))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const itRisk = riskScores.find(r => r.department === "IT");
  const criticalFindings = findings.filter(f => f.severity === "critical" || f.severity === "high");
  const openFindings = findings.filter(f => f.status === "open");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Security & IT Dashboard"
        description="Cyber obligations, control evidence, vulnerability findings, and SLA exposure."
      />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {dashLoading ? Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />) :
          kpis.filter(m => ["Compliance Score", "Total Obligations"].includes(m.title)).concat(
            [
              { title: "Open Findings", value: String(openFindings.length), change: `${criticalFindings.length} critical/high`, changeType: openFindings.length > 0 ? "negative" : "positive" as const, icon: "Scale" },
              { title: "IT Readiness", value: itRisk ? `${itRisk.score}%` : "—", change: itRisk ? (itRisk.score < 60 ? "Below threshold" : "On track") : "", changeType: itRisk && itRisk.score < 60 ? "negative" : "positive" as const, icon: "ShieldCheck" },
            ]
          ).slice(0, 4).map((m, i) => {
            const Icon = iconMap[m.icon];
            return <KPICard key={m.title} title={m.title} value={m.value} change={m.change} changeType={m.changeType} icon={Icon} index={i} />;
          })}
      </div>

      <GlassCard className="p-0 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#b0c6ff]" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Security Findings</h3>
          </div>
          <span className="text-xs text-[#8c90a1]">{findings.length} total · {openFindings.length} open</span>
        </div>
        {loading && <div className="p-6 text-sm text-[#8c90a1] animate-pulse">Loading findings…</div>}
        {error && <ErrorState message={error} onRetry={() => {}} />}
        {!loading && !error && findings.length === 0 && (
          <div className="p-8 text-center">
            <CheckCircle className="w-10 h-10 text-emerald-400 mx-auto mb-3" />
            <p className="text-sm text-[#8c90a1]">No security findings. Import via the integrations endpoint.</p>
          </div>
        )}
        <div className="divide-y divide-white/[0.04] max-h-96 overflow-y-auto">
          {findings.map((f, i) => (
            <motion.div key={f.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.04 }}
              className="px-5 py-3.5 hover:bg-[#273647]/20 transition-colors flex items-center gap-4">
              <div className="flex items-center gap-2">
                {f.severity === "critical" || f.severity === "high" ? <AlertTriangle className="w-4 h-4 text-red-400" /> :
                  f.severity === "medium" ? <Search className="w-4 h-4 text-amber-400" /> :
                  <CheckCircle className="w-4 h-4 text-emerald-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[#d4e4fa] truncate">{f.title}</p>
                <p className="text-xs text-[#8c90a1]">{f.source.toUpperCase()} · {f.asset ?? f.department ?? "—"}</p>
              </div>
              <StatusBadge status={f.severity} variant={f.severity === "critical" || f.severity === "high" ? "error" : f.severity === "medium" ? "warning" : "default"} />
              <StatusBadge status={f.status} variant={f.status === "open" ? "warning" : "success"} />
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
