import {
  ALL_CATALOG_ALLOWED_HOSTS,
  catalogEntryById,
  REGULATORY_FEED_CATALOG,
} from "@/lib/regulatory-feed-catalog";

export type FeedHealth = "healthy" | "delayed" | "failed" | "unknown";

const MS_HOUR = 3600_000;
const MS_DAY = 24 * MS_HOUR;
const HEALTHY_MAX_AGE_MS = MS_DAY;
const DELAYED_MAX_AGE_MS = 7 * MS_DAY;

function isLegacySlot(catalogSlotId: string): boolean {
  return catalogSlotId.startsWith("legacy_");
}

function allowedHostsForSlot(catalogSlotId: string): string[] {
  if (isLegacySlot(catalogSlotId)) return ALL_CATALOG_ALLOWED_HOSTS;
  const entry = catalogEntryById(catalogSlotId);
  return entry?.allowedHosts ?? [];
}

/**
 * Returns normalized HTTPS URL string or an error message.
 */
export function validateFeedUrlForSlot(catalogSlotId: string, rawUrl: string): { ok: true; url: string } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { ok: false, error: "URL is required" };
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }
  if (u.protocol !== "https:") return { ok: false, error: "Only HTTPS URLs are allowed" };
  if (u.username || u.password) return { ok: false, error: "URL must not contain credentials" };
  const host = u.hostname.toLowerCase();
  if (!host || host.includes(":")) return { ok: false, error: "Invalid host" };
  // Reject bare IPv4 literals (belt-and-suspenders)
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return { ok: false, error: "IP address hosts are not allowed" };

  const allowed = allowedHostsForSlot(catalogSlotId);
  if (!allowed.length) return { ok: false, error: "Unknown catalog slot" };
  if (!allowed.includes(host)) {
    return {
      ok: false,
      error: `Host must be one of: ${allowed.join(", ")}`,
    };
  }
  return { ok: true, url: u.toString() };
}

export function defaultFeedUrlForSlot(catalogSlotId: string): string | undefined {
  return catalogEntryById(catalogSlotId)?.feedUrl;
}

/**
 * Operational health from persisted fetch timestamps (best-effort).
 */
export function computeFeedHealth(input: {
  lastFetchSuccessAt: string | null;
  lastFetchAttemptAt: string | null;
  lastFetchError: string | null;
  nowMs?: number;
}): FeedHealth {
  const now = input.nowMs ?? Date.now();
  const successAt = input.lastFetchSuccessAt ? Date.parse(input.lastFetchSuccessAt) : NaN;
  const attemptAt = input.lastFetchAttemptAt ? Date.parse(input.lastFetchAttemptAt) : NaN;
  const hasSuccess = Number.isFinite(successAt);
  const hasAttempt = Number.isFinite(attemptAt);

  if (!hasSuccess && !hasAttempt && !input.lastFetchError) return "unknown";

  if (input.lastFetchError && hasAttempt) {
    const errRecent = now - attemptAt < MS_HOUR;
    const successStale = !hasSuccess || now - successAt > HEALTHY_MAX_AGE_MS;
    if (errRecent && successStale) return "failed";
  }

  if (hasSuccess && now - successAt < HEALTHY_MAX_AGE_MS) return "healthy";
  if (hasSuccess && now - successAt < DELAYED_MAX_AGE_MS) return "delayed";
  if (hasSuccess) return "delayed";
  return "unknown";
}

export function catalogSlotIds(): string[] {
  return REGULATORY_FEED_CATALOG.map((e) => e.id);
}
