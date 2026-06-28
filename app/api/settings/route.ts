import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;

  const supabase = getSupabaseServerClient();
  if (!principal.organizationId) return NextResponse.json({}, { status: 200 });

  const { data, error } = await supabase
    .from("organizations")
    .select("id, name, slug, settings")
    .eq("id", principal.organizationId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? {});
}

export async function PATCH(req: NextRequest) {
  const principal = await requirePermission(req, "settings.manage");
  if (isAuthResponse(principal)) return principal;

  if (!principal.organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const allowedFields = ["name", "settings"];
  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("organizations")
    .update(updates)
    .eq("id", principal.organizationId)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  await writeAudit(supabase, principal, {
    action: "settings_changed",
    target: "Organization settings",
    details: `Updated org settings: ${Object.keys(updates).join(", ")}`,
    metadata: updates,
  });

  return NextResponse.json(data);
}
