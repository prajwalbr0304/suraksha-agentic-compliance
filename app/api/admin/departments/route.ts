/**
 * Manager department administration (org-scoped).
 *   GET  — list departments
 *   POST — create a department
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json([], { status: 200 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .select("*")
    .eq("organization_id", principal.organizationId)
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "departments.manage");
  if (isAuthResponse(principal)) return principal;
  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const name = String(body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({
      organization_id: principal.organizationId,
      name,
      head: body.head ? String(body.head) : null,
      email: body.email ? String(body.email) : null,
      risk_level: body.risk_level ? String(body.risk_level) : "medium",
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await writeAudit(supabase, principal, {
    action: "department_created",
    target: name,
    targetId: data.id,
    details: `Created department ${name}`,
  });
  return NextResponse.json(data, { status: 201 });
}
