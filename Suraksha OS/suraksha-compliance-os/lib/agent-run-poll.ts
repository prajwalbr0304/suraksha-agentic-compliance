import type { TenantApiFn } from "@/contexts/tenant-api-context";
import { agentRunErrorMessage } from "@/lib/agent-run-error";

/** One row from ``agent_runs`` (progress polling). */
export type AgentRunRow = {
  id: string;
  organization_id: string | null;
  agent: string;
  trigger: string;
  status: string;
  summary: string | null;
  stats?: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
};

function parseStats(row: AgentRunRow): {
  stageIndex: number;
  label: string | null;
  failedStage: number | null;
  err: string | null;
} {
  const s = row.stats;
  if (!s || typeof s !== "object") {
    return { stageIndex: 0, label: null, failedStage: null, err: null };
  }
  const idx = typeof s.pipeline_stage_index === "number" ? s.pipeline_stage_index : 0;
  const label = typeof s.pipeline_stage_label === "string" ? s.pipeline_stage_label : null;
  const failed =
    typeof s.pipeline_failed_stage_index === "number" ? s.pipeline_failed_stage_index : null;
  const err = typeof s.pipeline_error_message === "string" ? s.pipeline_error_message : null;
  return { stageIndex: idx, label, failedStage: failed, err };
}

/** Poll until ``completed`` or ``failed``; invoke ``onTick`` on every sample. */
export async function pollAgentRunUntilDone(
  api: TenantApiFn,
  runId: string,
  onTick: (row: AgentRunRow) => void,
  opts?: { intervalMs?: number; maxWaitMs?: number },
): Promise<AgentRunRow> {
  const intervalMs = opts?.intervalMs ?? 2000;
  const maxWaitMs = opts?.maxWaitMs ?? 3_600_000;
  const started = Date.now();

  for (;;) {
    if (Date.now() - started > maxWaitMs) {
      throw new Error("Timed out waiting for the agent run to finish. Check the agent-service terminal.");
    }
    const r = await api(`/api/agents/runs/progress?run_id=${encodeURIComponent(runId)}`);
    const body = (await r.json().catch(() => ({}))) as AgentRunRow | { error?: string };
    if (!r.ok) {
      throw new Error(agentRunErrorMessage(body, "Failed to read run progress"));
    }
    const row = body as AgentRunRow;
    onTick(row);
    if (row.status === "completed") return row;
    if (row.status === "failed") {
      const { err, failedStage, stageIndex, label } = parseStats(row);
      const at = failedStage ?? stageIndex;
      const stageHint = ` (failed at step ${at + 1}${label ? `: ${label}` : ""})`;
      throw new Error((err || row.summary || "Agent run failed") + stageHint);
    }
    await new Promise((res) => setTimeout(res, intervalMs));
  }
}
