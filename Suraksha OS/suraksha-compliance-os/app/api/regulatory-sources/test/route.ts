import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthResponse, requireOrgContext, requirePermission } from "@/lib/auth/permissions";
import { defaultFeedUrlForSlot, validateFeedUrlForSlot } from "@/lib/regulatory-feed-url-policy";

export const runtime = "nodejs";

/** Browser-like UA: some regulator CDNs return HTML blocks for non-browser agents. */
const UA =
  process.env.SURAKSHA_HTTP_USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SurakshaCompliance/1.0";

function decodeXmlTitle(raw: string): string {
  let s = raw.trim();
  const cdata = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i);
  if (cdata) s = cdata[1] ?? s;
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
}

function sampleRssTitles(xml: string, limit: number): string[] {
  const titles: string[] = [];
  const re = /<item[\s\S]*?<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && titles.length < limit) {
    const block = m[0];
    const tm = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (tm?.[1]) titles.push(decodeXmlTitle(tm[1]));
  }
  return titles;
}

async function persistProbeResult(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  sourceId: string,
  organizationId: string,
  ok: boolean,
  errorText: string | null,
) {
  const now = new Date().toISOString();
  if (ok) {
    await supabase
      .from("regulatory_sources")
      .update({
        last_fetch_attempt_at: now,
        last_fetch_success_at: now,
        last_fetch_error: null,
        last_checked_at: now,
      })
      .eq("id", sourceId)
      .eq("organization_id", organizationId);
  } else {
    await supabase
      .from("regulatory_sources")
      .update({
        last_fetch_attempt_at: now,
        last_fetch_error: (errorText || "probe_failed").slice(0, 2000),
        last_checked_at: now,
      })
      .eq("id", sourceId)
      .eq("organization_id", organizationId);
  }
}

/**
 * POST — probe a catalog feed URL under slot policy (not arbitrary internet).
 */
export async function POST(req: NextRequest) {
  const principal = await requirePermission(req, "obligations.create");
  if (isAuthResponse(principal)) return principal;
  const orgErr = requireOrgContext(principal);
  if (orgErr) return orgErr;

  let body: { feedUrl?: string; sourceId?: string | null; catalogSlotId?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();
  let catalogSlotId = String(body.catalogSlotId || "").trim();
  let feedUrl = String(body.feedUrl || "").trim();
  const sourceId = body.sourceId ? String(body.sourceId).trim() : "";

  if (sourceId) {
    const { data: row, error } = await supabase
      .from("regulatory_sources")
      .select("id, feed_url, catalog_slot_id, organization_id")
      .eq("id", sourceId)
      .eq("organization_id", principal.organizationId!)
      .maybeSingle();
    if (error || !row) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    catalogSlotId = String((row as { catalog_slot_id: string }).catalog_slot_id);
    if (!feedUrl) feedUrl = String((row as { feed_url: string }).feed_url);
  }

  if (!catalogSlotId) {
    return NextResponse.json({ error: "catalogSlotId or sourceId is required" }, { status: 400 });
  }
  if (!feedUrl) {
    const def = defaultFeedUrlForSlot(catalogSlotId);
    if (!def) return NextResponse.json({ error: "Unknown catalog slot" }, { status: 400 });
    feedUrl = def;
  }

  const validated = validateFeedUrlForSlot(catalogSlotId, feedUrl);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  feedUrl = validated.url;

  const started = Date.now();
  try {
    const res = await fetch(feedUrl, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, text/html, */*" },
      signal: AbortSignal.timeout(20_000),
    });
    const ms = Date.now() - started;
    if (!res.ok) {
      if (sourceId) await persistProbeResult(supabase, sourceId, principal.organizationId!, false, `HTTP ${res.status}`);
      return NextResponse.json(
        { ok: false, status: res.status, message: `HTTP ${res.status}`, ms },
        { status: 200 },
      );
    }
    const text = await res.text();
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    const looksXml =
      ct.includes("xml") ||
      feedUrl.endsWith(".xml") ||
      text.trimStart().startsWith("<?xml") ||
      /<rss[\s>]/i.test(text.slice(0, 500));
    if (looksXml) {
      const titles = sampleRssTitles(text, 5);
      if (sourceId) await persistProbeResult(supabase, sourceId, principal.organizationId!, true, null);
      return NextResponse.json({
        ok: true,
        mode: "rss" as const,
        ms,
        sampleTitles: titles,
        message: titles.length ? `Fetched ${titles.length} recent item title(s).` : "RSS reachable; no <item> titles parsed (format may differ).",
      });
    }
    if (sourceId) await persistProbeResult(supabase, sourceId, principal.organizationId!, true, null);
    return NextResponse.json({
      ok: true,
      mode: "html" as const,
      ms,
      sampleTitles: [] as string[],
      message: "Page reachable (HTML). The monitoring agent uses HTML scraping for this source.",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (sourceId) await persistProbeResult(supabase, sourceId, principal.organizationId!, false, msg);
    return NextResponse.json({ ok: false, message: msg, ms: Date.now() - started }, { status: 200 });
  }
}
