import type { TenantApiFn } from "@/contexts/tenant-api-context";
import { agentRunErrorMessage } from "@/lib/agent-run-error";
import { pollAgentRunUntilDone } from "@/lib/agent-run-poll";

export type AgentPipeline = "full" | "validate" | "watch" | "download" | "process_regulations";

/**
 * POST /api/agents/runs and return immediately; follow completion in the background.
 * Use for non-blocking UX (toast + live agent_events / dashboard refetch).
 */
export function startAgentPipelineInBackground(
  api: TenantApiFn,
  pipeline: AgentPipeline,
  opts: {
    onStarted?: (runId: string) => void;
    onFinished?: () => void;
    onError?: (message: string) => void;
    /** Extra fields merged into the POST body (e.g. ``{ source_id }`` for per-source scans). */
    extraBody?: Record<string, unknown>;
  },
): void {
  void (async () => {
    try {
      const res = await api("/api/agents/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pipeline, ...(opts.extraBody ?? {}) }),
      });
      const b = (await res.json().catch(() => ({}))) as {
        accepted?: boolean;
        run_id?: string;
        error?: string;
      };
      if (!res.ok) {
        opts.onError?.(agentRunErrorMessage(b, "Agent run failed"));
        return;
      }
      if (res.status === 202 && b.accepted && b.run_id) {
        opts.onStarted?.(b.run_id);
        try {
          await pollAgentRunUntilDone(api, b.run_id, () => {});
          opts.onFinished?.();
        } catch (e) {
          opts.onError?.(e instanceof Error ? e.message : String(e));
        }
        return;
      }
      opts.onError?.("Unexpected agent response. Restart agent-service and try again.");
    } catch (e) {
      opts.onError?.(e instanceof Error ? e.message : String(e));
    }
  })();
}
