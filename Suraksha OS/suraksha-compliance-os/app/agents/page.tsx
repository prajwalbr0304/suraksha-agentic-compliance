"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard, StatusBadge } from "@/components/ui/glass-card";
import { ErrorState } from "@/components/ui/loading-states";
import { ComplianceLiveOperations } from "@/components/compliance-live-operations";
import { useDashboard } from "@/hooks/use-dashboard";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { startAgentPipelineInBackground } from "@/lib/agent-run-async";
import { toast } from "sonner";
import {
  Bot,
  RefreshCw,
  Radar,
  GitBranch,
  CheckCircle2,
  Activity,
  Network,
  Route,
  ShieldCheck,
  ListTodo,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActivityLogMode } from "@/types";

interface AgentRun {
  id: string;
  agent: string;
  trigger: string;
  status: string;
  summary: string | null;
  started_at: string;
  finished_at: string | null;
  stats?: Record<string, unknown> | null;
}
interface RegChange {
  id: string;
  regulator: string | null;
  title: string;
  url: string | null;
  status: string;
  created_at: string;
}
interface Health {
  status: string;
  llm_configured?: boolean;
  llm_backend?: string;
  model?: string;
  scheduler?: boolean;
}

function latestRun(runs: AgentRun[], agents: string[]): AgentRun | null {
  const list = runs.filter((r) => agents.includes(r.agent));
  if (!list.length) return null;
  return [...list].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
}

function fmtRun(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

function numStat(stats: Record<string, unknown> | null | undefined, key: string): string {
  if (!stats || stats[key] === undefined || stats[key] === null) return "—";
  const v = stats[key];
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  return "—";
}

export default function AgentsPage() {
  const api = useTenantApi();
  const [activityLogMode, setActivityLogMode] = useState<ActivityLogMode>("compact");
  const {
    aiActivityFeed,
    queueMetrics,
    isLoading: liveOpsLoading,
    refetch: refetchLiveOps,
    liveCoordinatorRun,
  } = useDashboard({ activityLogMode });
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [changes, setChanges] = useState<RegChange[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pipelineBusy, setPipelineBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [r, s] = await Promise.all([
        api("/api/agents/runs"),
        api("/api/agents/status"),
      ]);
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || "Failed to load runs");
      }
      setRuns(await r.json());
      if (s.ok) {
        const sd = await s.json();
        setHealth(sd.health);
        setChanges(sd.changes);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => {
    load();
  }, [load]);

  const healthy = health?.status === "ok";

  const agentRows = useMemo(() => {
    const monitoring = latestRun(runs, ["regwatcher"]);
    const pipeline = latestRun(runs, ["coordinator", "pipeline"]);
    const validator = latestRun(runs, ["validator"]);
    const monStats = (monitoring?.stats ?? null) as Record<string, unknown> | null;
    const pipeStats = (pipeline?.stats ?? null) as Record<string, unknown> | null;
    const valStats = (validator?.stats ?? null) as Record<string, unknown> | null;
    return [
      {
        name: "Monitoring Agent",
        icon: Radar,
        status: healthy ? "Active" : "Unavailable",
        statusVariant: healthy ? ("success" as const) : ("error" as const),
        lastRun: fmtRun(monitoring?.finished_at ?? monitoring?.started_at),
        obligations: numStat(monStats, "new"),
        tasks: "—",
        blurb: "Scans regulatory feeds for new circulars and advisories.",
      },
      {
        name: "Extraction Agent",
        icon: Network,
        status: healthy ? "Active" : "Unavailable",
        statusVariant: healthy ? ("success" as const) : ("error" as const),
        lastRun: fmtRun(pipeline?.finished_at ?? pipeline?.started_at),
        obligations: numStat(pipeStats, "obligations"),
        tasks: "—",
        blurb: "Turns regulatory text into structured obligations.",
      },
      {
        name: "Routing Agent",
        icon: Route,
        status: healthy ? "Active" : "Unavailable",
        statusVariant: healthy ? ("success" as const) : ("error" as const),
        lastRun: fmtRun(pipeline?.finished_at ?? pipeline?.started_at),
        obligations: "—",
        tasks: numStat(pipeStats, "maps"),
        blurb: "Creates MAPs and assigns work to bank departments.",
      },
      {
        name: "Validation Agent",
        icon: ShieldCheck,
        status: healthy ? "Active" : "Unavailable",
        statusVariant: healthy ? ("success" as const) : ("error" as const),
        lastRun: fmtRun(validator?.finished_at ?? validator?.started_at),
        obligations: numStat(valStats, "validated"),
        tasks: numStat(valStats, "completed"),
        blurb: "Checks evidence and updates MAP / readiness status.",
      },
    ];
  }, [runs, healthy]);

  const runFullFire = useCallback(() => {
    if (pipelineBusy) return;
    setPipelineBusy(true);
    toast.info("Full automation started — queue and timeline update below.");
    startAgentPipelineInBackground(api, "full", {
      onStarted: () => {
        void refetchLiveOps();
      },
      onFinished: () => {
        setPipelineBusy(false);
        toast.success("Compliance automation finished");
        void load();
        void refetchLiveOps();
      },
      onError: (m) => {
        setPipelineBusy(false);
        toast.error(m);
      },
    });
  }, [api, load, pipelineBusy, refetchLiveOps]);

  const runValidateFire = useCallback(() => {
    if (pipelineBusy) return;
    setPipelineBusy(true);
    toast.info("Evidence validation started — watch live operations below.");
    startAgentPipelineInBackground(api, "validate", {
      onStarted: () => {
        void refetchLiveOps();
      },
      onFinished: () => {
        setPipelineBusy(false);
        toast.success("Validation finished");
        void load();
        void refetchLiveOps();
      },
      onError: (m) => {
        setPipelineBusy(false);
        toast.error(m);
      },
    });
  }, [api, load, pipelineBusy, refetchLiveOps]);

  const scanFeedsFire = useCallback(() => {
    if (pipelineBusy) return;
    setPipelineBusy(true);
    toast.info("Feed scan started — live queue updates when detections land.");
    startAgentPipelineInBackground(api, "watch", {
      onStarted: () => {
        void refetchLiveOps();
      },
      onFinished: () => {
        setPipelineBusy(false);
        toast.success("Feed scan complete");
        void load();
        void refetchLiveOps();
      },
      onError: (m) => {
        setPipelineBusy(false);
        toast.error(m);
      },
    });
  }, [api, load, pipelineBusy, refetchLiveOps]);

  if (error)
    return (
      <div className="space-y-6">
        <PageHeader title="AI Agents" description="Autonomous regulatory monitoring and MAP generation." />
        <ErrorState message={error} onRetry={load} />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agents"
        description="Curated regulatory monitoring sources and one-place controls for scan, extraction, and evidence validation."
        actions={
          <button
            type="button"
            onClick={() => load()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] text-sm"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5">
        <GlassCard className="p-5 flex flex-col gap-4">
          <div>
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Automation controls</h3>
            <p className="text-xs text-[#8c90a1] mt-1">
              Scan checks RSS/HTML feeds. Full automation processes new detections into obligations and MAPs, then drift,
              impact, and audit. Manage monitoring sources in the Regulation Center.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => void scanFeedsFire()}
              disabled={pipelineBusy}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#424655]/40 bg-[#273647]/40 px-4 py-3 text-sm text-[#d4e4fa] disabled:opacity-60"
            >
              <Radar className="w-4 h-4 shrink-0" />
              Scan feeds
            </button>
            <button
              type="button"
              onClick={() => void runFullFire()}
              disabled={pipelineBusy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#b0c6ff] px-4 py-3 text-sm font-medium text-[#002d6f] disabled:opacity-60"
            >
              <ListTodo className="w-4 h-4 shrink-0" />
              Process pending regulations
            </button>
            <button
              type="button"
              onClick={() => void runValidateFire()}
              disabled={pipelineBusy}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#424655]/40 bg-[#273647]/40 px-4 py-3 text-sm text-[#d4e4fa] disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Validate evidence
            </button>
          </div>
          <p className="text-[11px] text-[#6b7280] leading-relaxed">
            “Process pending regulations” runs monitor → PDF ingest (Regulation Center) → optional queue extraction → MAPs when
            auto-process is on; otherwise approve items in Regulation Center and use “Process queue” or the{" "}
            <code className="text-[10px] text-[#b0c6ff]">process_regulations</code> pipeline. Drift, impact, and audit still run at the end of a full pass.
          </p>
        </GlassCard>
      </div>

      <ComplianceLiveOperations
        queue={queueMetrics}
        feed={aiActivityFeed}
        isLoading={liveOpsLoading}
        liveCoordinatorRun={liveCoordinatorRun}
        activityLogMode={activityLogMode}
        onActivityLogModeChange={setActivityLogMode}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <GlassCard className="p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center">
            <Bot className={cn("w-5 h-5", healthy ? "text-emerald-400" : "text-red-400")} />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#d4e4fa]">Agent Service</p>
            <p className="text-xs text-[#8c90a1]">
              {healthy ? `Online · ${health?.model}` : "Unreachable — start agent-service"}
            </p>
          </div>
        </GlassCard>
        <GlassCard className="p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center">
            <Radar className="w-5 h-5 text-[#b0c6ff]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#d4e4fa]">{changes.length}</p>
            <p className="text-xs text-[#8c90a1]">Regulatory changes on file</p>
          </div>
        </GlassCard>
        <GlassCard className="p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#273647]/40 flex items-center justify-center">
            <Activity className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[#d4e4fa]">{runs.length}</p>
            <p className="text-xs text-[#8c90a1]">Automation runs recorded</p>
          </div>
        </GlassCard>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-[#d4e4fa] mb-3">Agent fleet status</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agentRows.map((row, i) => (
            <motion.div key={row.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <GlassCard className="p-5 h-full border border-[#424655]/25 hover:border-[#b0c6ff]/20 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-xl bg-[#b0c6ff]/10 flex items-center justify-center shrink-0">
                      <row.icon className="w-5 h-5 text-[#b0c6ff]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#d4e4fa]">{row.name}</p>
                      <p className="text-xs text-[#8c90a1] mt-0.5 line-clamp-2">{row.blurb}</p>
                    </div>
                  </div>
                  <StatusBadge status={row.status} variant={row.statusVariant} />
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs border-t border-white/[0.06] pt-3">
                  <div>
                    <dt className="text-[#8c90a1]">Last run</dt>
                    <dd className="text-[#d4e4fa] font-medium mt-0.5">{row.lastRun}</dd>
                  </div>
                  <div>
                    <dt className="text-[#8c90a1]">Obligations / validations</dt>
                    <dd className="text-[#d4e4fa] font-medium mt-0.5 tabular-nums">{row.obligations}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[#8c90a1]">MAPs assigned / completed</dt>
                    <dd className="text-[#d4e4fa] font-medium mt-0.5 tabular-nums">{row.tasks}</dd>
                  </div>
                </dl>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <Radar className="w-4 h-4 text-[#b0c6ff]" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Regulatory feed (detected)</h3>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
            {changes.map((c) => (
              <div key={c.id} className="px-5 py-3 hover:bg-[#273647]/15">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[#d4e4fa] truncate">{c.title}</p>
                    <p className="text-xs text-[#8c90a1]">
                      {c.regulator ?? "—"} · {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <StatusBadge status={c.status} variant={c.status === "mapped" ? "success" : c.status === "error" ? "error" : c.status === "duplicate" ? "warning" : "info"} />
                </div>
              </div>
            ))}
            {!loading && changes.length === 0 && (
              <div className="px-5 py-8 text-center text-[#8c90a1]">
                No changes detected yet. Use Monitor feeds or Run compliance automation.
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#b0c6ff]" />
            <h3 className="text-sm font-semibold text-[#d4e4fa]">Recent automation runs</h3>
          </div>
          <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
            {runs.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.02 }}
                className="px-5 py-3 hover:bg-[#273647]/15"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-[#d4e4fa] capitalize">
                      {r.agent} <span className="text-[#8c90a1]">· {r.trigger}</span>
                    </p>
                    <p className="text-xs text-[#8c90a1] truncate">{r.summary ?? "—"}</p>
                  </div>
                  <StatusBadge status={r.status} variant={r.status === "completed" ? "success" : r.status === "failed" ? "error" : "warning"} />
                </div>
              </motion.div>
            ))}
            {!loading && runs.length === 0 && <div className="px-5 py-8 text-center text-[#8c90a1]">No agent runs yet.</div>}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
