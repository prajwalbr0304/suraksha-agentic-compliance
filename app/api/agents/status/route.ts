/**
 * GET /api/agents/status — agent service health + detected regulatory changes (org-scoped).
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

const AGENT_URL = process.env.AGENT_SERVICE_URL || "http://localhost:8088";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  let health: unknown = { status: "unreachable" };
  try {
    const res = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) health = await res.json();
  } catch {
    health = { status: "unreachable", url: AGENT_URL };
  }

  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("regulatory_changes")
    .select("id, regulator, title, url, status, published_at, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (principal.organizationId) q = q.eq("organization_id", principal.organizationId);
  const { data: changes } = await q;

  return NextResponse.json({ health, changes: changes ?? [] });
}
