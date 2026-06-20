import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) {
    return NextResponse.json({ error: "Select an organization (founders pass x-suraksha-org-id)" }, { status: 400 });
  }

  const runId = req.nextUrl.searchParams.get("run_id")?.trim();
  if (!runId) {
    return NextResponse.json({ error: "run_id query parameter is required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("organization_id", principal.organizationId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json(data);
}
