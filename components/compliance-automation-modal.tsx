"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRunRow } from "@/lib/agent-run-poll";

const STEPS_FULL = [
  "Monitoring regulatory feeds…",
  "Extracting obligations…",
  "Generating MAPs…",
  "Assigning departments…",
  "Drift & impact analysis…",
  "Recording audit summary…",
];

const STEPS_VALIDATE = [
  "Loading open MAPs…",
  "Validating compliance evidence…",
  "Updating MAP completion status…",
  "Recomputing readiness scores…",
  "Recording audit summary…",
];

function formatElapsed(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m <= 0) return `${s}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function readStageIndex(stats: Record<string, unknown> | null | undefined): number {
  if (!stats || typeof stats.pipeline_stage_index !== "number") return 0;
  return Math.max(0, Math.floor(stats.pipeline_stage_index));
}

function readFailedIndex(stats: Record<string, unknown> | null | undefined): number | null {
  if (!stats || typeof stats.pipeline_failed_stage_index !== "number") return null;
  return Math.max(0, Math.floor(stats.pipeline_failed_stage_index));
}

function readStageLabel(stats: Record<string, unknown> | null | undefined): string | null {
  if (!stats || typeof stats.pipeline_stage_label !== "string") return null;
  return stats.pipeline_stage_label;
}

export interface ComplianceAutomationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Start the run; call ``report`` whenever progress is known (Supabase row snapshot).
   * Should resolve when the run completes, or throw on failure / timeout.
   */
  executeRun: (report: (row: AgentRunRow) => void) => Promise<void>;
  pipeline: "full" | "validate";
  onSuccess?: () => void;
}

export function ComplianceAutomationModal({
  open,
  onOpenChange,
  executeRun,
  pipeline,
  onSuccess,
}: ComplianceAutomationModalProps) {
  const steps = pipeline === "validate" ? STEPS_VALIDATE : STEPS_FULL;
  const [phase, setPhase] = useState<"running" | "success" | "error">("running");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [liveRow, setLiveRow] = useState<AgentRunRow | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runGenerationRef = useRef(0);

  const executeRunRef = useRef(executeRun);
  const onSuccessRef = useRef(onSuccess);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    executeRunRef.current = executeRun;
    onSuccessRef.current = onSuccess;
    onOpenChangeRef.current = onOpenChange;
  }, [executeRun, onSuccess, onOpenChange]);

  const clearTimers = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      clearTimers();
      setLiveRow(null);
      return;
    }

    const gen = ++runGenerationRef.current;
    setPhase("running");
    setErrorMessage(null);
    setElapsedSec(0);
    setLiveRow(null);

    tickRef.current = setInterval(() => {
      setElapsedSec((s) => s + 1);
    }, 1000);

    void executeRunRef
      .current((row) => {
        if (runGenerationRef.current !== gen) return;
        setLiveRow(row);
      })
      .then(() => {
        if (runGenerationRef.current !== gen) return;
        clearTimers();
        setPhase("success");
        onSuccessRef.current?.();
        closeTimerRef.current = setTimeout(() => {
          if (runGenerationRef.current !== gen) return;
          onOpenChangeRef.current(false);
        }, 1600);
      })
      .catch((e: unknown) => {
        if (runGenerationRef.current !== gen) return;
        clearTimers();
        setPhase("error");
        setErrorMessage(e instanceof Error ? e.message : "Automation failed");
      });

    return () => {
      runGenerationRef.current += 1;
      clearTimers();
    };
  }, [open, pipeline, clearTimers]);

  const stats = liveRow?.stats as Record<string, unknown> | null | undefined;
  const currentIdx = readStageIndex(stats);
  const liveLabel = readStageLabel(stats);
  const failedIdx =
    phase === "error" && liveRow?.status === "failed"
      ? readFailedIndex(stats) ?? readStageIndex(stats)
      : null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" aria-hidden />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="relative z-10 w-full max-w-lg rounded-2xl border border-[#424655]/40 bg-[#0a1929] shadow-2xl p-8"
            role="dialog"
            aria-labelledby="automation-modal-title"
            aria-busy={phase === "running"}
          >
            <h2 id="automation-modal-title" className="text-lg font-semibold text-[#d4e4fa]">
              {pipeline === "validate" ? "Validating compliance evidence" : "Running compliance automation"}
            </h2>
            <p className="text-sm text-[#8c90a1] mt-1 mb-2">
              Progress updates from the live agent run in your database. The job still executes on the agent service;
              this view polls every few seconds until the run finishes.
            </p>
            {phase === "running" && (
              <p className="text-sm font-medium text-[#b0c6ff] mb-1 flex items-center gap-2">
                <Loader2 className="w-4 h-4 shrink-0 animate-spin" aria-hidden />
                Elapsed {formatElapsed(elapsedSec)}
              </p>
            )}
            {phase === "running" && liveLabel && (
              <p className="text-xs text-[#8c90a1] mb-4 truncate" title={liveLabel}>
                Current: <span className="text-[#b0c6ff]">{liveLabel}</span>
              </p>
            )}
            {phase === "running" && !liveLabel && (
              <p className="text-xs text-[#8c90a1] mb-4">Connecting to agent progress…</p>
            )}

            <p className="text-xs font-medium uppercase tracking-wide text-[#8c90a1] mb-2">Pipeline stages</p>
            <ul className="space-y-2 mb-1">
              {steps.map((label, i) => {
                const done =
                  phase === "success" ||
                  (phase === "running" && currentIdx > i) ||
                  (phase === "error" && failedIdx !== null && i < failedIdx);
                const runningNow = phase === "running" && currentIdx === i;
                const failedHere = phase === "error" && failedIdx !== null && i === failedIdx;

                return (
                  <li
                    key={label}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                      done && "border-emerald-500/35 bg-emerald-500/5 text-emerald-200",
                      runningNow && "border-[#b0c6ff]/40 bg-[#b0c6ff]/5 text-[#d4e4fa]",
                      !done && !runningNow && !failedHere && "border-white/[0.06] text-[#8c90a1]",
                      failedHere && "border-red-500/40 bg-red-500/10 text-red-200",
                    )}
                  >
                    {done ? (
                      <Check className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden />
                    ) : failedHere ? (
                      <XCircle className="w-4 h-4 shrink-0 text-red-400" aria-hidden />
                    ) : runningNow ? (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin text-[#b0c6ff]" aria-hidden />
                    ) : (
                      <span className="w-4 h-4 shrink-0 rounded-full border border-[#424655]/60" aria-hidden />
                    )}
                    <span>
                      <span className="text-[10px] uppercase tracking-wide text-[#6b7280] mr-2">Step {i + 1}</span>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>

            {phase === "error" && errorMessage && (
              <div className="mt-5 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {phase === "success" && (
              <p className="mt-5 text-sm font-medium text-emerald-400">Automation finished successfully.</p>
            )}

            {phase === "error" && (
              <button
                type="button"
                className="mt-5 w-full rounded-lg border border-[#424655]/40 py-2 text-sm text-[#d4e4fa] hover:bg-[#273647]/30"
                onClick={() => onOpenChange(false)}
              >
                Close
              </button>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
