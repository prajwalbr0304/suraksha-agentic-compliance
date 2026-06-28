import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/auth/audit";
import { catalogEntryById, REGULATORY_FEED_CATALOG } from "@/lib/regulatory-feed-catalog";
import { computeFeedHealth, validateFeedUrlForSlot } from "@/lib/regulatory-feed-url-policy";

export const runtime = "nodejs";

type DbRegSource = {
  id: string;
  regulator: string;
  feed_url: string;
  enabled: boolean;
  last_checked_at: string | null;
  catalog_slot_id: string;
  source_name: string | null;
  source_type: string | null;
  last_fetch_attempt_at: string | null;
  last_fetch_success_at: string | null;
  last_fetch_error: string | null;
  fetch_interval_minutes?: number | null;
  lookback_days?: number | null;
  auto_download_pdf?: boolean | null;
  auto_process?: boolean | null;
  approval_required?: boolean | null;
  fetch_watermark_published_at?: string | null;
};

function buildMergedSources(rows: DbRegSource[]) {
  const bySlot = new Map(rows.filter((r) => REGULATORY_FEED_CATALOG.some((c) => c.id === r.catalog_slot_id)).map((r) => [r.catalog_slot_id, r]));

  return REGULATORY_FEED_CATALOG.map((c) => {
    const row = bySlot.get(c.id);
    const feedUrl = row?.feed_url ?? c.feedUrl;
    const displayLabel = (row?.source_name && row.source_name.trim()) || c.label;
    const health = computeFeedHealth({
      lastFetchSuccessAt: row?.last_fetch_success_at ?? null,
      lastFetchAttemptAt: row?.last_fetch_attempt_at ?? null,
      lastFetchError: row?.last_fetch_error ?? null,
    });
    return {
      catalogId: c.id,
      label: c.label,
      displayLabel,
      description: c.description,
      regulator: c.regulator,
      feedUrl,
      defaultFeedUrl: c.feedUrl,
      sourceType: row?.source_type ?? c.sourceType,
      sourceId: row?.id ?? null,
      enabled: row ? row.enabled : false,
      lastCheckedAt: row?.last_checked_at ?? null,
      lastFetchAttemptAt: row?.last_fetch_attempt_at ?? null,
      lastFetchSuccessAt: row?.last_fetch_success_at ?? null,
      lastFetchError: row?.last_fetch_error ?? null,
      health,
      allowedHosts: c.allowedHosts,
      fetchIntervalMinutes: row?.fetch_interval_minutes ?? 360,
      lookbackDays: row?.lookback_days ?? 7,
      autoDownloadPdf: row?.auto_download_pdf ?? true,
      autoProcess: row?.auto_process ?? false,
      approvalRequired: row?.approval_required ?? false,
      fetchWatermarkPublishedAt: row?.fetch_watermark_published_at ?? null,
    };
  });
}

/**
 * GET — merged catalog + org ``regulatory_sources`` rows (read).
 */
export async function GET(req: NextRequest) {
  const principal = await requirePermission(req, "documents.read");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  const supabase = getSupabaseServerClient();
  const { data: rows, error } = await supabase
    .from("regulatory_sources")
    .select(
      "id, regulator, feed_url, enabled, last_checked_at, catalog_slot_id, source_name, source_type, last_fetch_attempt_at, last_fetch_success_at, last_fetch_error, fetch_interval_minutes, lookback_days, auto_download_pdf, auto_process, approval_required, fetch_watermark_published_at",
    )
    .eq("organization_id", principal.organizationId!);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const merged = buildMergedSources((rows as DbRegSource[]) ?? []);

  const { count: pending } = await supabase
    .from("regulatory_changes")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", principal.organizationId!)
    .in("lifecycle_status", ["new", "awaiting_approval", "queued", "processing", "failed_ingest", "failed_processing"]);

  return NextResponse.json({
    sources: merged,
    pendingRegulationsCount: pending ?? 0,
  });
}

/**
 * POST — add / enable a catalog feed (``obligations.create``).
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  let body: { catalogId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const entry = catalogEntryById(String(body.catalogId || ""));
  if (!entry) {
    return NextResponse.json({ error: "Unknown catalog feed" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const payload = {
    organization_id: principal.organizationId!,
    catalog_slot_id: entry.id,
    regulator: entry.regulator,
    feed_url: entry.feedUrl,
    source_type: entry.sourceType,
    enabled: true,
  };

  const { data, error } = await supabase
    .from("regulatory_sources")
    .upsert(payload, { onConflict: "organization_id,catalog_slot_id" })
    .select(
      "id, regulator, feed_url, enabled, last_checked_at, catalog_slot_id, source_name, source_type, last_fetch_attempt_at, last_fetch_success_at, last_fetch_error, fetch_interval_minutes, lookback_days, auto_download_pdf, auto_process, approval_required, fetch_watermark_published_at",
    )
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Upsert failed" }, { status: 500 });
  }

  await writeAudit(supabase, principal, {
    action: "regulatory_source_enabled",
    target: entry.label,
    targetId: data.id,
    details: `Enabled monitoring: ${entry.label}`,
    metadata: { feed_url: entry.feedUrl, regulator: entry.regulator, catalog_slot_id: entry.id },
  });

  return NextResponse.json({ source: data });
}

/**
 * PATCH — enable / disable / edit URL or display name for a source by id.
 */
export async function PATCH(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  let body: {
    id?: string;
    enabled?: boolean;
    feed_url?: string;
    source_name?: string | null;
    fetch_interval_minutes?: number;
    lookback_days?: number;
    auto_download_pdf?: boolean;
    auto_process?: boolean;
    approval_required?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (
    body.enabled === undefined &&
    body.feed_url === undefined &&
    body.source_name === undefined &&
    body.fetch_interval_minutes === undefined &&
    body.lookback_days === undefined &&
    body.auto_download_pdf === undefined &&
    body.auto_process === undefined &&
    body.approval_required === undefined
  ) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  const { data: existing, error: fetchErr } = await supabase
    .from("regulatory_sources")
    .select("id, feed_url, regulator, catalog_slot_id")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const slotId = String((existing as { catalog_slot_id?: string }).catalog_slot_id || "");
  const patch: Record<string, unknown> = {};

  if (typeof body.enabled === "boolean") {
    patch.enabled = body.enabled;
  }
  if (body.feed_url !== undefined) {
    const v = validateFeedUrlForSlot(slotId, String(body.feed_url));
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    patch.feed_url = v.url;
  }
  if (body.source_name !== undefined) {
    const name = body.source_name === null ? null : String(body.source_name).trim().slice(0, 200);
    patch.source_name = name || null;
  }
  if (body.fetch_interval_minutes !== undefined) {
    const n = Math.max(1, Math.min(10080, Number(body.fetch_interval_minutes) || 360));
    patch.fetch_interval_minutes = n;
  }
  if (body.lookback_days !== undefined) {
    const n = Math.max(1, Math.min(365, Number(body.lookback_days) || 7));
    patch.lookback_days = n;
  }
  if (typeof body.auto_download_pdf === "boolean") {
    patch.auto_download_pdf = body.auto_download_pdf;
  }
  if (typeof body.auto_process === "boolean") {
    patch.auto_process = body.auto_process;
  }
  if (typeof body.approval_required === "boolean") {
    patch.approval_required = body.approval_required;
  }

  const selectCols =
    "id, regulator, feed_url, enabled, last_checked_at, catalog_slot_id, source_name, source_type, last_fetch_attempt_at, last_fetch_success_at, last_fetch_error, fetch_interval_minutes, lookback_days, auto_download_pdf, auto_process, approval_required, fetch_watermark_published_at";

  const { data, error } = await supabase
    .from("regulatory_sources")
    .update(patch)
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .select(selectCols)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Update failed" }, { status: 500 });
  }

  if (body.feed_url !== undefined) {
    await writeAudit(supabase, principal, {
      action: "regulatory_source_url_updated",
      target: existing.regulator ?? "regulatory",
      targetId: id,
      details: `Updated feed URL for slot ${slotId}`,
      metadata: { catalog_slot_id: slotId, feed_url: patch.feed_url },
    });
  }
  if (typeof body.enabled === "boolean") {
    await writeAudit(supabase, principal, {
      action: body.enabled ? "regulatory_source_enabled" : "regulatory_source_disabled",
      target: existing.regulator ?? "regulatory",
      targetId: id,
      details: body.enabled ? `Re-enabled feed slot ${slotId}` : `Paused feed slot ${slotId}`,
      metadata: { catalog_slot_id: slotId },
    });
  }

  return NextResponse.json({ source: data });
}

/**
 * DELETE — remove an org's configured source row by id (``obligations.create``).
 * The catalog slot remains available to re-add later; only the org binding is removed.
 */
export async function DELETE(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
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
    .from("regulatory_sources")
    .select("id, regulator, catalog_slot_id, source_name")
    .eq("id", id)
    .eq("organization_id", principal.organizationId!)
    .maybeSingle();

  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("regulatory_sources")
    .delete()
    .eq("id", id)
    .eq("organization_id", principal.organizationId!);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await writeAudit(supabase, principal, {
    action: "regulatory_source_deleted",
    target: (existing as { source_name?: string | null; regulator?: string }).source_name || existing.regulator || "regulatory",
    targetId: id,
    details: `Removed monitoring source (slot ${(existing as { catalog_slot_id?: string }).catalog_slot_id ?? "?"})`,
    metadata: { catalog_slot_id: (existing as { catalog_slot_id?: string }).catalog_slot_id },
  });

  return NextResponse.json({ deleted: true });
}
