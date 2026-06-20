/**
 * Agent runs.
 *   GET  — list recent agent_runs for the caller's org (from Supabase)
 *   POST — trigger an agent pipeline via the Python ADK service
 *
 * Uses Undici `fetch` + custom `Agent` with a generous timeout because some
 * environments still hit slow paths; for `full`, `validate`, and `watch`, the
 * agent service returns **202** immediately after enqueueing work and the client
 * should poll `/api/agents/runs/progress` (or rely on Supabase `agent_events`).
 */
import { Agent, fetch as undiciFetch } from "undici";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

/** Long agent runs (local Ollama is slow). Hosted platforms may still cap the route — see maxDuration. */
export const maxDuration = 900;

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8088";
const AGENT_SECRET = (process.env.AGENT_SHARED_SECRET || "").trim();

function agentRunProxyTimeoutMs(): number {
  const raw = process.env.AGENT_RUN_PROXY_TIMEOUT_MS;
  if (raw != null && raw.trim() !== "") {
    const n = Number.parseInt(raw.trim(), 10);
    if (Number.isFinite(n) && n >= 60_000) return Math.min(n, 3_600_000);
  }
  return 900_000;
}

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const supabase = getSupabaseServerClient();
  let q = supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(25);
  if (principal.organizationId) q = q.eq("organization_id", principal.organizationId);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) {
    return NextResponse.json({ error: "Select an organization (founders pass x-suraksha-org-id)" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* default */ }
  const pipeline = ["watch", "download", "full", "validate", "process_regulations"].includes(String(body.pipeline))
    ? String(body.pipeline)
    : "full";

  const sourceId = typeof body.source_id === "string" && body.source_id.trim() ? body.source_id.trim() : undefined;

  const proxyTimeoutMs = agentRunProxyTimeoutMs();
  const undiciMs = Math.min(proxyTimeoutMs + 120_000, 3_600_000);
  const dispatcher = new Agent({
    connectTimeout: 30_000,
    headersTimeout: undiciMs,
    bodyTimeout: undiciMs,
  });
  try {
    const res = await undiciFetch(`${AGENT_URL}/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-secret": AGENT_SECRET,
      },
      body: JSON.stringify({
        organization_id: principal.organizationId,
        pipeline,
        ...(sourceId ? { source_id: sourceId } : {}),
      }),
      signal: AbortSignal.timeout(proxyTimeoutMs),
      dispatcher,
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isAbort =
      (e instanceof DOMException && e.name === "AbortError") ||
      (e instanceof Error && e.name === "AbortError") ||
      /aborted|timeout/i.test(msg);
    const error = isAbort
      ? `Agent run timed out after ${Math.round(proxyTimeoutMs / 1000)}s waiting for ${AGENT_URL}. The job may still be running in the agent terminal — check uvicorn logs. For slower local LLMs, set AGENT_RUN_PROXY_TIMEOUT_MS (ms, max 3600000) and keep maxDuration in this route within your host limit.`
      : `Agent service unreachable at ${AGENT_URL}. Is it running? (${msg})`;
    return NextResponse.json({ error }, { status: 502 });
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}
