import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

type LogLine = {
  id: string;
  ts: string;
  level: string;
  stage: string | null;
  message: string;
  agent: string | null;
  source: string;
  regulatoryChangeId?: string | null;
  runId?: string | null;
};

function levelFromStatus(status: string | null | undefined): string {
  const s = (status || "").toLowerCase();
  if (s === "failed" || s === "error") return "ERROR";
  if (s === "completed" || s === "success" || s === "succeeded") return "SUCCESS";
  if (s === "warn" || s === "warning") return "WARN";
  return "INFO";
}

function levelFromEventType(type: string | null | undefined): string {
  const t = (type || "").toLowerCase();
  if (t.includes("error")) return "ERROR";
  if (t.includes("success") || t === "change_detected" || t.includes("completed")) return "SUCCESS";
  if (t.includes("warn")) return "WARN";
  return "INFO";
}

/**
 * GET — unified live logs for the Regulation Center.
 *
 * Query params:
 *   run_id              — limit agent_events to a specific run.
 *   regulatory_change_id — limit processing-log lines to one change.
 *   limit               — max lines per source (default 120, max 300).
 *
 * Merges ``regulation_processing_log`` (per-stage, per-change) with ``agent_events``
 * (per-run) into one time-ordered stream for the console view.
 */
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  const { searchParams } = new URL(req.url);
  const runId = String(searchParams.get("run_id") || "").trim();
  const changeId = String(searchParams.get("regulatory_change_id") || "").trim();
  const limit = Math.min(300, Math.max(1, Number(searchParams.get("limit") || "120")));

  const supabase = getSupabaseServerClient();
  const orgId = principal.organizationId!;

  let procQ = supabase
    .from("regulation_processing_log")
    .select("id, regulatory_change_id, stage, status, message, agent_name, started_at, ended_at")
    .eq("organization_id", orgId)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (changeId) procQ = procQ.eq("regulatory_change_id", changeId);

  let evtQ = supabase
    .from("agent_events")
    .select("id, run_id, type, message, payload, created_at")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (runId) evtQ = evtQ.eq("run_id", runId);

  const [{ data: procRows, error: procErr }, { data: evtRows, error: evtErr }] = await Promise.all([
    procQ,
    evtQ,
  ]);

  if (procErr && evtErr) {
    return NextResponse.json({ error: procErr.message || evtErr.message }, { status: 500 });
  }

  const lines: LogLine[] = [];

  for (const r of procRows ?? []) {
    const row = r as {
      id: string;
      regulatory_change_id: string | null;
      stage: string | null;
      status: string | null;
      message: string | null;
      agent_name: string | null;
      started_at: string;
      ended_at: string | null;
    };
    lines.push({
      id: `proc:${row.id}`,
      ts: row.ended_at || row.started_at,
      level: levelFromStatus(row.status),
      stage: row.stage,
      message: row.message || `${row.stage ?? "stage"} ${row.status ?? ""}`.trim(),
      agent: row.agent_name,
      source: "processing",
      regulatoryChangeId: row.regulatory_change_id,
    });
  }

  for (const e of evtRows ?? []) {
    const row = e as {
      id: string;
      run_id: string | null;
      type: string | null;
      message: string | null;
      payload: Record<string, unknown> | null;
      created_at: string;
    };
    const agent =
      row.payload && typeof row.payload.agent === "string" ? (row.payload.agent as string) : null;
    lines.push({
      id: `evt:${row.id}`,
      ts: row.created_at,
      level: levelFromEventType(row.type),
      stage: row.type,
      message: row.message || row.type || "event",
      agent,
      source: "agent",
      runId: row.run_id,
    });
  }

  lines.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return NextResponse.json({ lines: lines.slice(0, limit) });
}
