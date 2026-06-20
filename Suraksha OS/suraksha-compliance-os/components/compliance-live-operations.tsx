"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Copy,
  FileStack,
  Layers,
  Loader2,
  Sparkles,
  Terminal,
  Activity,
  type LucideIcon,
} from "lucide-react";
import type { ActivityLogMode } from "@/types";
import type { AgentQueueMetrics, AiActivityItem, LiveCoordinatorRunState } from "@/types";
import { cn } from "@/lib/utils";

function toneIcon(tone: AiActivityItem["tone"]) {
  if (tone === "error") return <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" aria-hidden />;
  if (tone === "warning") return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden />;
  if (tone === "success") return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden />;
  return <Sparkles className="w-4 h-4 text-[#b0c6ff] shrink-0 mt-0.5" aria-hidden />;
}

function formatRunClock(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function runElapsed(iso: string): { label: string; minutes: number } {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { label: "—", minutes: 0 };
  const sec = Math.floor((Date.now() - t) / 1000);
  const minutes = sec / 60;
  if (sec < 60) return { label: `${sec}s`, minutes };
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return { label: `${m}m ${s.toString().padStart(2, "0")}s`, minutes: m };
}

function QueueStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0d1a28]/80 px-4 py-3 flex gap-3 min-w-0">
      <div className="w-9 h-9 rounded-lg bg-[#b0c6ff]/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-[#b0c6ff]" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[#8c90a1]">{label}</p>
        <p className="text-xl font-semibold tabular-nums text-[#d4e4fa] leading-tight">{value}</p>
        {hint ? <p className="text-[10px] text-[#6b7280] mt-1 leading-snug">{hint}</p> : null}
      </div>
    </div>
  );
}

function PipelineStatusBanner({ run }: { run: LiveCoordinatorRunState | null }) {
  const elapsed = run?.startedAt ? runElapsed(run.startedAt) : null;
  const stuck = run?.status === "running" && elapsed && elapsed.minutes >= 45;

  if (!run) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-[#0d1a28]/60 px-4 py-3 text-sm text-[#8c90a1]">
        <span className="text-[#6b7280]">Pipeline:</span> Idle — run compliance automation to stream coordinator progress, stages, and errors here.
      </div>
    );
  }

  if (run.status === "running") {
    return (
      <div className="space-y-2">
        <div className="rounded-xl border border-[#b0c6ff]/25 bg-[#b0c6ff]/8 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 gap-y-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-200 border border-amber-500/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
              </span>
              Running
            </span>
            {run.pipeline ? (
              <span className="text-[11px] uppercase tracking-wide text-[#6b7280]">Pipeline · {run.pipeline}</span>
            ) : null}
            <span className="text-[11px] font-mono text-[#8c90a1]">Started {formatRunClock(run.startedAt)}</span>
            {elapsed ? (
              <span className="text-[11px] font-mono text-[#b0c6ff]/90">Elapsed {elapsed.label}</span>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-[#d4e4fa] font-medium leading-snug">
            {run.stageLabel ?? "Working… (waiting for next progress update from agent-service)"}
          </p>
          {run.stageKey ? (
            <p className="mt-1 text-[11px] font-mono text-[#6b7280]">
              Stage key: <span className="text-[#8c90a1]">{run.stageKey}</span>
              {run.stageIndex != null ? ` · index ${run.stageIndex}` : null}
            </p>
          ) : null}
        </div>
        {stuck ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100 leading-relaxed">
            This run has been active for a long time. If the agent-service terminal shows no activity, check logs or
            restart the service — the UI will keep polling until the run row completes.
          </div>
        ) : null}
      </div>
    );
  }

  if (run.status === "failed") {
    return (
      <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/20 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-200">
            Failed
          </span>
          {run.pipeline ? (
            <span className="text-[11px] uppercase text-[#8c90a1]">{run.pipeline}</span>
          ) : null}
        </div>
        <p className="text-sm text-red-100 font-medium">{run.errorMessage ?? run.summary ?? "Automation run failed."}</p>
        {run.stageLabel ? (
          <p className="text-[11px] text-[#fca5a5]/90">Last stage: {run.stageLabel}</p>
        ) : null}
      </div>
    );
  }

  /* completed */
  return (
    <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-200 border border-emerald-500/30">
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />
          Completed
        </span>
        {run.pipeline ? (
          <span className="text-[11px] uppercase tracking-wide text-[#6b7280]">{run.pipeline}</span>
        ) : null}
        {run.finishedAt ? (
          <span className="text-[11px] font-mono text-[#8c90a1]">Finished {formatRunClock(run.finishedAt)}</span>
        ) : null}
      </div>
      {run.summary ? <p className="mt-2 text-sm text-[#d4e4fa]/90 leading-snug">{run.summary}</p> : null}
    </div>
  );
}

export function ComplianceLiveOperations({
  queue,
  feed,
  isLoading,
  liveCoordinatorRun = null,
  activityLogMode = "compact",
  onActivityLogModeChange,
}: {
  queue: AgentQueueMetrics | null;
  feed: AiActivityItem[];
  isLoading: boolean;
  liveCoordinatorRun?: LiveCoordinatorRunState | null;
  activityLogMode?: ActivityLogMode;
  onActivityLogModeChange?: (mode: ActivityLogMode) => void;
}) {
  const q = queue ?? {
    pendingPDFs: 0,
    pdfDocumentQueue: 0,
    processing: 0,
    deferred: 0,
    duplicatesSkipped: 0,
  };

  const pendingHint =
    q.pdfDocumentQueue > 0
      ? `Includes ${q.pdfDocumentQueue} PDF file(s) in document upload / parse queue`
      : "Regulations detected, not yet linked to a stored document";

  const fullLogs = activityLogMode === "full";
  const listMaxHeight = fullLogs ? "min(78vh, 920px)" : "480px";

  const displayRun = useMemo(() => {
    if (liveCoordinatorRun) return liveCoordinatorRun;
    return null;
  }, [liveCoordinatorRun]);

  return (
    <div className="rounded-2xl border border-[#b0c6ff]/20 bg-gradient-to-b from-[#0a1929] to-[#07121c] overflow-hidden shadow-xl shadow-black/20">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-white/[0.06] bg-[#b0c6ff]/8">
        <Layers className="w-5 h-5 text-[#b0c6ff]" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-[#d4e4fa]">Live operations center</h3>
          <p className="text-xs text-[#8c90a1]">Queue, coordinator pipeline stage, and agent_events stream</p>
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5 border-b border-white/[0.05] bg-black/10">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8c90a1] mb-3">Queue status</p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-[#8c90a1] py-4">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden />
            Loading queue metrics…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <QueueStat label="Pending PDFs" value={q.pendingPDFs} hint={pendingHint} icon={FileStack} />
            <QueueStat label="Processing" value={q.processing} hint="Active agent runs (coordinator, pipeline, …)" icon={Loader2} />
            <QueueStat label="Deferred" value={q.deferred} hint="Last full run: changes held for next run (cap)" icon={Clock} />
            <QueueStat label="Duplicates skipped" value={q.duplicatesSkipped} hint="Feed items linked to existing PDF checksum" icon={Copy} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 border-b border-white/[0.04] bg-[#b0c6ff]/5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Bot className="w-5 h-5 text-[#b0c6ff] shrink-0" aria-hidden />
            <div className="min-w-0">
              <h4 className="text-sm font-semibold text-[#d4e4fa]">Live activity timeline</h4>
              <p className="text-xs text-[#8c90a1]">
                {q.processing > 0 ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" aria-hidden />
                    Fast refresh while runs are active (~2s) + Supabase realtime
                  </span>
                ) : (
                  "Updates from agent_events and automation audit rows"
                )}
              </p>
            </div>
          </div>
          {onActivityLogModeChange ? (
            <button
              type="button"
              onClick={() => onActivityLogModeChange(fullLogs ? "compact" : "full")}
              className={cn(
                "inline-flex items-center gap-2 shrink-0 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                fullLogs
                  ? "border-[#b0c6ff]/50 bg-[#b0c6ff]/15 text-[#d4e4fa]"
                  : "border-[#424655]/50 bg-[#273647]/30 text-[#8c90a1] hover:text-[#d4e4fa] hover:border-[#b0c6ff]/30",
              )}
            >
              <Terminal className="w-4 h-4 shrink-0" aria-hidden />
              {fullLogs ? "Hide full logs" : "Show full logs"}
            </button>
          ) : null}
        </div>
        <PipelineStatusBanner run={displayRun} />
      </div>

      <div
        className="overflow-y-auto px-2 sm:px-4 py-3"
        style={{ maxHeight: listMaxHeight }}
      >
        {isLoading ? (
          <div className="p-6 text-center text-sm text-[#8c90a1] animate-pulse">Loading activity…</div>
        ) : feed.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-sm text-[#8c90a1]">No automation events yet.</p>
            <p className="text-xs text-[#8c90a1]/80">
              Run <span className="text-[#d4e4fa]">Run compliance automation</span> — events stream here in real time.
            </p>
          </div>
        ) : (
          <ol className="relative ms-3 border-s border-[#424655]/60 space-y-0">
            {feed.map((item, i) => (
              <motion.li
                key={item.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.015, 0.25) }}
                className="ms-6 pb-5 last:pb-2"
              >
                <span className="absolute flex items-center justify-center w-3 h-3 rounded-full -start-1.5 mt-1.5 ring-4 ring-[#0a1929] bg-[#b0c6ff]/90" />
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-transparent hover:border-[#424655]/40 hover:bg-[#273647]/20 px-3 py-2 -mx-1 transition-colors">
                  <time
                    className="font-mono text-[11px] text-[#b0c6ff]/90 tabular-nums shrink-0"
                    dateTime={item.sortKey}
                  >
                    {item.timeLabel ?? "—"}
                  </time>
                  <span className="text-[11px] text-[#6b7280]">{item.timestamp}</span>
                  <div className="flex items-start gap-2 w-full min-w-0">
                    {toneIcon(item.tone)}
                    <div className="flex-1 min-w-0 space-y-1">
                      <p className="text-sm text-[#d4e4fa] leading-snug break-words">{item.line}</p>
                      {item.detail ? (
                        <p className="text-[11px] font-mono text-[#6b7280] leading-relaxed break-all border-l-2 border-[#424655]/50 pl-2">
                          {item.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </motion.li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
