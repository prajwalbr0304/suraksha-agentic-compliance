import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";

export const runtime = "nodejs";

async function nextProcessingOrder(supabase: ReturnType<typeof getSupabaseServerClient>, organizationId: string) {
  const { data } = await supabase
    .from("regulatory_changes")
    .select("processing_order")
    .eq("organization_id", organizationId)
    .not("processing_order", "is", null)
    .order("processing_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = typeof data?.processing_order === "number" ? data.processing_order : 0;
  return max + 1;
}

/**
 * GET — list regulatory_changes for Regulation Center inbox (read: documents.read).
 */
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  const { searchParams } = new URL(req.url);
  const lifecycle = searchParams.get("lifecycle_status");
  const regulator = searchParams.get("regulator");
  const enabledOnly = searchParams.get("enabled");
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || "50")));

  const supabase = getSupabaseServerClient();
  let q = supabase
    .from("regulatory_changes")
    .select(
      "id, organization_id, source_id, regulator, external_ref, title, url, published_at, raw_text, status, document_id, created_at, lifecycle_status, enabled, paused, approved_at, approved_by, rejected_at, rejection_reason, pdf_checksum_sha256, pdf_stage, queued_at, processing_order, tags, category, executive_summary, ingestion_error, resolved_pdf_url, duplicate_of_id, manual_pdf_storage_path, retry_count"
    )
    .eq("organization_id", principal.organizationId!)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (lifecycle) {
    q = q.eq("lifecycle_status", lifecycle);
  }
  if (regulator) {
    q = q.eq("regulator", regulator);
  }
  if (enabledOnly === "true") {
    q = q.eq("enabled", true);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ changes: data ?? [] });
}

type PatchBody = {
  id?: string;
  action?: string;
  rejectionReason?: string | null;
  manualPdfStoragePath?: string | null;
};

/**
 * PATCH — inbox actions (obligations.assign): approve, reject, enable, disable, pause, reprocess, retry_download.
 */
export async function PATCH(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.assign");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id || "").trim();
  const action = String(body.action || "").trim().toLowerCase();
  if (!id || !action) {
    return NextResponse.json({ error: "id and action are required" }, { status: 400 });
  }

  const allowed = new Set([
    "approve",
    "reject",
    "enable",
    "disable",
    "pause",
    "resume",
    "reprocess",
    "retry_download",
  ]);
  if (!allowed.has(action)) {
    return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("regulatory_changes")
    .select("id, organization_id, title, regulator, lifecycle_status, document_id")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }

  if (action === "approve" && !existing.document_id) {
    return NextResponse.json(
      {
        error:
          "This regulation has no downloaded PDF yet. Use Download (Sources or Monitor) to fetch the PDF before approving.",
      },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  let patch: Record<string, unknown> = {};

  switch (action) {
    case "approve": {
      const po = await nextProcessingOrder(supabase, principal.organizationId!);
      patch = {
        lifecycle_status: "queued",
        status: "detected",
        approved_at: now,
        approved_by: principal.userId,
        rejected_at: null,
        rejection_reason: null,
        queued_at: now,
        processing_order: po,
        queue_position: 0,
      };
      break;
    }
    case "reject": {
      patch = {
        lifecycle_status: "rejected",
        status: "error",
        rejected_at: now,
        rejection_reason: (body.rejectionReason && String(body.rejectionReason).slice(0, 2000)) || "Rejected",
        queued_at: null,
        processing_order: null,
        queue_position: null,
      };
      break;
    }
    case "enable":
      patch = { enabled: true };
      break;
    case "disable":
      patch = { enabled: false, paused: false };
      break;
    case "pause":
      patch = { paused: true };
      break;
    case "resume":
      patch = { paused: false };
      break;
    case "reprocess": {
      const po2 = await nextProcessingOrder(supabase, principal.organizationId!);
      patch = {
        lifecycle_status: "queued",
        status: "detected",
        ingestion_error: null,
        processing_started_at: null,
        queued_at: now,
        processing_order: po2,
        queue_position: 0,
      };
      break;
    }
    case "retry_download":
      patch = {
        lifecycle_status: "new",
        status: "detected",
        pdf_stage: "none",
        ingestion_error: null,
        resolved_pdf_url: null,
        document_id: null,
        manual_pdf_storage_path:
          body.manualPdfStoragePath === undefined
            ? undefined
            : body.manualPdfStoragePath === null
              ? null
              : String(body.manualPdfStoragePath).trim().slice(0, 1024) || null,
      };
      break;
    default:
      return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const { data: updated, error: upErr } = await supabase
    .from("regulatory_changes")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .select("id, lifecycle_status, enabled, paused, queued_at, processing_order")
    .single();

  if (upErr || !updated) {
    return NextResponse.json({ error: upErr?.message ?? "Update failed" }, { status: 500 });
  }

  await writeAudit(supabase, principal, {
    action: `regulation_center_${action}`,
    target: existing.title ?? "regulatory_change",
    targetId: id,
    details: `Regulation Center: ${action}`,
    metadata: { lifecycle_status: updated.lifecycle_status },
  });

  return NextResponse.json({ change: updated });
}

/**
 * DELETE — remove a regulatory_change (and its cascading chunks/log) by id (``obligations.assign``).
 */
export async function DELETE(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.assign");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("regulatory_changes")
    .select("id, title, lifecycle_status")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Change not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("regulatory_changes")
    .delete()
    .eq("id", id)
    .eq("organization_id", principal.organizationId!);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit(supabase, principal, {
    action: "regulation_center_delete",
    target: existing.title ?? "regulatory_change",
    targetId: id,
    details: "Regulation Center: deleted regulation",
    metadata: { lifecycle_status: existing.lifecycle_status },
  });

  return NextResponse.json({ deleted: true });
}
