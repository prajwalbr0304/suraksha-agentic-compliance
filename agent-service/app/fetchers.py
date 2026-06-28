"""Regulatory change fetchers.

Live-scrapes RBI / SEBI / PMLA notification feeds. On empty parse or network
failure, returns [] unless SURAKSHA_REGULATORY_FEED_SAMPLES is true (demo only).
"""
from __future__ import annotations

import hashlib
import os
from typing import Any

import httpx
import feedparser
from bs4 import BeautifulSoup

from .pdf_ingest import _normalize_rbi_https

# Public notification feeds (best-effort; subject to change by the regulators).
DEFAULT_FEEDS = {
    "RBI": "https://www.rbi.org.in/notifications_rss.xml",
    "SEBI": "https://www.sebi.gov.in/sebirss.xml",
    "CERT-IN": "https://www.cert-in.org.in/",
    "NPCI": "https://www.npci.org.in/what-we-do/upi/circular",
    "UIDAI": "https://uidai.gov.in/en/about-uidai/legal-framework/circulars.html",
    "PMLA": "https://www.rbi.org.in/Scripts/Notification.aspx",
}

# Match pdf_ingest: some regulator CDNs block non-browser user-agents.
_DEFAULT_UA = (
    os.getenv("SURAKSHA_HTTP_USER_AGENT")
    or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36 SurakshaCompliance/1.0"
)
_HEADERS = {
    "User-Agent": _DEFAULT_UA,
    "Accept": "application/rss+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
}


def _use_sample_fallback() -> bool:
    v = os.getenv("SURAKSHA_REGULATORY_FEED_SAMPLES", "false").strip().lower()
    return v in ("1", "true", "yes", "on")


def _ref(regulator: str, key: str) -> str:
    return f"{regulator}-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]


def _sample(regulator: str) -> list[dict[str, Any]]:
    samples = {
        "RBI": [
            {"title": "Master Direction – KYC (Amendment) 2026", "summary": "Banks must implement periodic re-KYC for high-risk customers and adopt video-based customer identification (V-CIP) within 90 days.", "url": "https://www.rbi.org.in/"},
            {"title": "Cyber Security Framework – Incident Reporting", "summary": "Regulated entities must report material cyber incidents to RBI within 6 hours and conduct quarterly VAPT of critical systems.", "url": "https://www.rbi.org.in/"},
        ],
        "SEBI": [
            {"title": "LODR Amendment – Material Event Disclosure", "summary": "Listed entities must disclose material events within 24 hours and strengthen related-party transaction controls.", "url": "https://www.sebi.gov.in/"},
        ],
        "CERT-IN": [
            {"title": "CERT-In Directions – Cyber Incident Reporting", "summary": "Service providers and banks must report cyber security incidents to CERT-In within 6 hours of detection and maintain logs for 180 days.", "url": "https://www.cert-in.org.in/"},
        ],
        "NPCI": [
            {"title": "NPCI Circular – UPI Transaction Security", "summary": "Member banks must enforce device binding and additional factor authentication for UPI, and monitor for fraud patterns.", "url": "https://www.npci.org.in/"},
        ],
        "UIDAI": [
            {"title": "UIDAI Circular – Aadhaar Data Security", "summary": "Authentication User Agencies must encrypt Aadhaar data at rest, conduct annual audits, and restrict access on a need-to-know basis.", "url": "https://uidai.gov.in/"},
        ],
        "PMLA": [
            {"title": "PMLA – Maintenance of Records", "summary": "Reporting entities must maintain transaction records for 5 years and file STRs for suspicious transactions promptly.", "url": "https://www.rbi.org.in/"},
        ],
    }
    out = []
    for s in samples.get(regulator, []):
        out.append({
            "external_ref": _ref(regulator, s["title"]),
            "title": s["title"],
            "url": s["url"],
            "published_at": None,
            "summary": s["summary"],
        })
    return out


def fetch_feed(regulator: str, feed_url: str, limit: int = 10) -> list[dict[str, Any]]:
    """Fetch and normalize the latest changes from a regulator feed."""
    return fetch_feed_result(regulator, feed_url, limit=limit)["items"]


def fetch_feed_result(regulator: str, feed_url: str, limit: int = 10) -> dict[str, Any]:
    """Fetch feed; returns ``items``, ``ok`` (HTTP success path), and ``error`` (nullable)."""
    try:
        resp = httpx.get(feed_url, headers=_HEADERS, timeout=20.0, follow_redirects=True)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")

        items: list[dict[str, Any]] = []
        if "xml" in content_type or feed_url.endswith(".xml"):
            parsed = feedparser.parse(resp.content)
            for entry in parsed.entries[:limit]:
                title = getattr(entry, "title", "Untitled")
                link = _normalize_rbi_https(getattr(entry, "link", feed_url))
                summary = BeautifulSoup(getattr(entry, "summary", ""), "html.parser").get_text(" ", strip=True)
                published = getattr(entry, "published", None)
                items.append({
                    "external_ref": _ref(regulator, link or title),
                    "title": title.strip()[:300],
                    "url": link,
                    "published_at": _parse_date(published),
                    "summary": summary[:4000] or title,
                })
        else:
            soup = BeautifulSoup(resp.text, "html.parser")
            for a in soup.select("a")[:200]:
                text = a.get_text(" ", strip=True)
                href = a.get("href") or ""
                if len(text) > 25 and any(k in text.lower() for k in ("circular", "notification", "direction", "guideline")):
                    items.append({
                        "external_ref": _ref(regulator, href or text),
                        "title": text[:300],
                        "url": href if href.startswith("http") else feed_url,
                        "published_at": None,
                        "summary": text[:4000],
                    })
                if len(items) >= limit:
                    break

        if items:
            return {"items": items, "ok": True, "error": None}
        if _use_sample_fallback():
            return {"items": _sample(regulator), "ok": True, "error": None}
        return {"items": [], "ok": True, "error": None}
    except Exception as e:
        if _use_sample_fallback():
            return {"items": _sample(regulator), "ok": True, "error": None}
        return {"items": [], "ok": False, "error": str(e)[:500]}


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        import email.utils as eut
        dt = eut.parsedate_to_datetime(value)
        return dt.isoformat()
    except Exception:
        return None
