"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useDashboard } from "@/hooks/use-dashboard";
import { GlassCard, PageHeader, HeroMetricCard, StatusBadge } from "@/components/ui/glass-card";
import { KPISkeleton, ErrorState } from "@/components/ui/loading-states";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";
import { withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";
import { startAgentPipelineInBackground } from "@/lib/agent-run-async";
import { ComplianceLiveOperations } from "@/components/compliance-live-operations";
import { Bot, GitBranch, Play, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import type { ActivityLogMode, RiskScore } from "@/types";
import { cn } from "@/lib/utils";

function riskBandStyles(band: RiskScore["riskBand"]) {
  if (band === "high") return { label: "High risk", wrap: "bg-red-500/15 border-red-500/35 text-red-200", bar: "#f87171" };
  if (band === "medium") return { label: "Medium risk", wrap: "bg-amber-500/12 border-amber-500/35 text-amber-100", bar: "#fbbf24" };
  return { label: "Low risk", wrap: "bg-emerald-500/10 border-emerald-500/30 text-emerald-100", bar: "#4ade80" };
}

export default function ComplianceDashboardPage() {
  const api = useTenantApi();
  const { principal } = usePrincipal();
  const [activityLogMode, setActivityLogMode] = useState<ActivityLogMode>("compact");
  const { heroMetrics, aiActivityFeed, queueMetrics, liveCoordinatorRun, riskScores, isLoading, error, refetch } =
    useDashboard({ activityLogMode });

  const mapBoardHref = useMemo(() => withTenantWorkspaceHref("/map-board", principal), [principal]);
  const agentsHref = useMemo(() => withTenantWorkspaceHref("/agents", principal), [principal]);

  const runFullAutomation = useCallback(() => {
    toast.info("Compliance automation started — watch live operations below.");
    startAgentPipelineInBackground(api, "full", {
      onStarted: () => {
        void refetch();
      },
      onFinished: () => {
        toast.success("Compliance automation finished");
        void refetch();
      },
      onError: (message) => toast.error(message),
    });
  }, [api, refetch]);

  const runValidateAutomation = useCallback(() => {
    toast.info("Evidence validation started — progress appears in live operations.");
    startAgentPipelineInBackground(api, "validate", {
      onStarted: () => {
        void refetch();
      },
      onFinished: () => {
        toast.success("Compliance evidence validation finished");
        void refetch();
      },
      onError: (message) => toast.error(message),
    });
  }, [api, refetch]);

  if (error)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Compliance command center"
          description="Live regulatory intelligence, obligations, MAPs, and readiness in one view."
        />
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Compliance command center"
        description="AI monitors regulations, extracts obligations, routes MAPs to departments, and updates readiness — in one place."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={mapBoardHref}
              className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 bg-[#273647]/30 px-4 py-2 text-sm font-medium text-[#d4e4fa] hover:bg-[#273647]/50"
            >
              <GitBranch className="w-4 h-4" />
              Open compliance action board
              <ArrowRight className="w-4 h-4 opacity-70" />
            </Link>
            <Link
              href={agentsHref}
              className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 px-4 py-2 text-sm text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/20"
            >
              <Bot className="w-4 h-4" />
              Agents
            </Link>
            <button
              type="button"
              onClick={runValidateAutomation}
              className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 px-4 py-2 text-sm text-[#d4e4fa] hover:bg-[#273647]/30"
            >
              Validate compliance evidence
            </button>
            <button
              type="button"
              onClick={runFullAutomation}
              className="inline-flex items-center gap-2 rounded-lg bg-[#b0c6ff] px-5 py-2 text-sm font-semibold text-[#002d6f] hover:bg-[#b0c6ff]/90"
            >
              <Play className="w-4 h-4" />
              Run compliance automation
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <KPISkeleton key={i} />)
          : heroMetrics.map((m, i) => <HeroMetricCard key={m.title} metric={m} index={i} />)}
      </div>

      <ComplianceLiveOperations
        queue={queueMetrics}
        feed={aiActivityFeed}
        isLoading={isLoading}
        liveCoordinatorRun={liveCoordinatorRun}
        activityLogMode={activityLogMode}
        onActivityLogModeChange={setActivityLogMode}
      />

      <GlassCard className="p-6">
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-1">Department risk overview</h3>
        <p className="text-xs text-[#8c90a1] mb-5">Heatmap by department — lower readiness scores mean higher operational risk</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {isLoading ? (
            <p className="text-sm text-[#8c90a1] animate-pulse col-span-full">Loading departments…</p>
          ) : (
            riskScores.slice(0, 9).map((r) => {
              const band = riskBandStyles(r.riskBand);
              return (
                <div
                  key={r.department}
                  className={cn("rounded-xl border px-4 py-3 flex flex-col gap-2", band.wrap)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-[#d4e4fa] truncate">{r.department}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider shrink-0">{band.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-black/25 overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${r.score}%`, backgroundColor: band.bar }} />
                    </div>
                    <span className="text-xs font-semibold tabular-nums w-10 text-right">{r.score}%</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-[#8c90a1]">
                    <span>{r.overdueCount} overdue</span>
                    <StatusBadge
                      status={r.trend === "up" ? "improving" : r.trend === "down" ? "declining" : "stable"}
                      variant={r.trend === "up" ? "success" : r.trend === "down" ? "error" : "default"}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </GlassCard>
    </div>
  );
}
