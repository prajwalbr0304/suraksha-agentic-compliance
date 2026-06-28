/**
 * POST /api/evidence — add evidence to an obligation
 * GET  /api/evidence?obligation_id=xxx — list evidence for an obligation
 * PUT  /api/evidence?id=xxx — mark evidence collected/uncollected
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { canAccessRow, isAuthResponse, requireOrgContext, requirePermission, withOrg } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const oblId = req.nextUrl.searchParams.get("obligation_id");
  const supabase = getSupabaseServerClient();
  if (oblId) {
    const { data: obligation } = await supabase
      .from("obligations")
      .select("id, department, assigned_to, created_by, organization_id")
      .eq("id", oblId)
      .eq("organization_id", principal.organizationId!)
      .maybeSingle();
    if (obligation && !canAccessRow(principal, obligation as Record<string, unknown>)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }
  let query = supabase.from("evidence").select("*").order("created_at", { ascending: true });
  query = query.eq("organization_id", principal.organizationId!);
  if (oblId) query = query.eq("obligation_id", oblId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "evidence.create");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const supabase = getSupabaseServerClient();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { obligation_id, document_id, title, description } = body;
  if (!obligation_id || !title) {
    return NextResponse.json({ error: "obligation_id and title are required" }, { status: 400 });
  }
  const { data: obligation } = await supabase
    .from("obligations")
    .select("id, department, assigned_to, created_by, organization_id")
    .eq("id", String(obligation_id))
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();
  if (!obligation || !canAccessRow(principal, obligation as Record<string, unknown>)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { data, error } = await supabase
    .from("evidence")
    .insert(withOrg(principal, {
      obligation_id: String(obligation_id),
      document_id: document_id ? String(document_id) : null,
      title: String(title),
      description: String(description ?? ""),
    }))
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update evidence_count on obligation (best-effort)
  try { await supabase.rpc("increment_evidence_count", { obl_id: obligation_id }); } catch { /* ignore */ }

  // Audit
  await writeAudit(supabase, principal, {
    action: "evidence_added",
    target: String(title),
    targetId: String(obligation_id),
    details: `Evidence added: ${title}`,
    metadata: { obligation_id },
  });

  return NextResponse.json(data, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const principal = await requirePermission(req, "evidence.create");
  if (isAuthResponse(principal)) return principal;
  const orgGuard = requireOrgContext(principal);
  if (orgGuard) return orgGuard;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = getSupabaseServerClient();
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const collected = typeof body.collected === "boolean" ? body.collected : Boolean(body.collected);
  const { data: existingEvidence } = await supabase
    .from("evidence")
    .select("id, obligation_id, organization_id, obligations(id, department, assigned_to, created_by, organization_id)")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();
  const obligation = Array.isArray(existingEvidence?.obligations) ? existingEvidence?.obligations[0] : existingEvidence?.obligations;
  if (!existingEvidence || (obligation && !canAccessRow(principal, obligation as Record<string, unknown>))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const updatePayload: Record<string, unknown> = {
    approval_status: principal.permissions.includes("evidence.approve") ? "approved" : "pending",
  };
  if (collected) {
    updatePayload.collected_at = new Date().toISOString().split("T")[0];
  } else {
    updatePayload.collected_at = null;
  }
  const { data, error } = await supabase
    .from("evidence")
    .update(updatePayload)
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });

  // Audit
  await writeAudit(supabase, principal, {
    action: "evidence_added",
    target: String(existingEvidence.obligation_id),
    targetId: id,
    details: `Evidence ${collected ? "collected" : "unmarked"}: ${id}`,
    metadata: { collected, evidence_id: id },
  });

  return NextResponse.json(data);
}
