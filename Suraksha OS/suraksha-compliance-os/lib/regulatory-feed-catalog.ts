/**
 * Curated regulatory feeds — stable slot ids, default URLs, and host allowlists
 * for controlled editing (no arbitrary domains). Mirrors agent-service defaults.
 */
export type FeedSourceType = "rss" | "html";

export type RegulatoryCatalogEntry = {
  id: string;
  regulator: string;
  label: string;
  description: string;
  feedUrl: string;
  sourceType: FeedSourceType;
  /** HTTPS hosts permitted when editing ``feed_url`` for this slot (no port tricks). */
  allowedHosts: string[];
};

export const REGULATORY_FEED_CATALOG: RegulatoryCatalogEntry[] = [
  {
    id: "rbi_notifications",
    regulator: "RBI",
    label: "RBI — Notifications RSS",
    description: "Official RBI notifications (XML).",
    feedUrl: "https://www.rbi.org.in/notifications_rss.xml",
    sourceType: "rss",
    allowedHosts: ["www.rbi.org.in", "rbi.org.in"],
  },
  {
    id: "rbi_press",
    regulator: "RBI",
    label: "RBI — Press releases RSS",
    description: "RBI press releases (XML).",
    feedUrl: "https://www.rbi.org.in/pressreleases_rss.xml",
    sourceType: "rss",
    allowedHosts: ["www.rbi.org.in", "rbi.org.in"],
  },
  {
    id: "sebi_rss",
    regulator: "SEBI",
    label: "SEBI — Circulars RSS",
    description: "SEBI RSS feed.",
    feedUrl: "https://www.sebi.gov.in/sebirss.xml",
    sourceType: "rss",
    allowedHosts: ["www.sebi.gov.in", "sebi.gov.in"],
  },
  {
    id: "cert_in",
    regulator: "CERT-IN",
    label: "CERT-IN — Advisories (HTML)",
    description: "CERT-In portal (HTML list; agent uses HTML fallback).",
    feedUrl: "https://www.cert-in.org.in/",
    sourceType: "html",
    allowedHosts: ["www.cert-in.org.in", "cert-in.org.in"],
  },
  {
    id: "npci",
    regulator: "NPCI",
    label: "NPCI — UPI circulars (HTML)",
    description: "NPCI UPI circulars page.",
    feedUrl: "https://www.npci.org.in/what-we-do/upi/circular",
    sourceType: "html",
    allowedHosts: ["www.npci.org.in", "npci.org.in"],
  },
  {
    id: "uidai",
    regulator: "UIDAI",
    label: "UIDAI — Legal framework (HTML)",
    description: "UIDAI circulars listing.",
    feedUrl: "https://uidai.gov.in/en/about-uidai/legal-framework/circulars.html",
    sourceType: "html",
    allowedHosts: ["uidai.gov.in", "www.uidai.gov.in"],
  },
  {
    id: "pmla_rbi",
    regulator: "PMLA",
    label: "PMLA — RBI notification hub (HTML)",
    description: "RBI PMLA-related notifications listing.",
    feedUrl: "https://www.rbi.org.in/Scripts/Notification.aspx",
    sourceType: "html",
    allowedHosts: ["www.rbi.org.in", "rbi.org.in"],
  },
];

/** Union of all catalog hosts — used for ``legacy_*`` slot rows only. */
export const ALL_CATALOG_ALLOWED_HOSTS: string[] = [
  ...new Set(REGULATORY_FEED_CATALOG.flatMap((e) => e.allowedHosts)),
];

const URL_SET = new Set(REGULATORY_FEED_CATALOG.map((e) => e.feedUrl));

export function catalogEntryById(id: string): RegulatoryCatalogEntry | undefined {
  return REGULATORY_FEED_CATALOG.find((e) => e.id === id);
}

/** @deprecated Prefer validateFeedUrlForSlot — kept for quick default-URL checks */
export function isCatalogFeedUrl(url: string): boolean {
  return URL_SET.has(url.trim());
}
