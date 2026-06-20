"""Resolve and download regulator PDFs from notification pages (RBI / generic HTML).

Conservative timeouts and size caps. Legal: respect regulator site policies and rate limits.
"""
from __future__ import annotations

import os
import re
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx
from bs4 import BeautifulSoup

# RBI's rbidocs host returns an HTML interstitial/block page for non-browser user-agents,
# which breaks PDF ingestion (body looks like HTML, not %PDF). Use a real browser UA;
# override with SURAKSHA_HTTP_USER_AGENT if your org requires a custom bot string.
_DEFAULT_UA = (
    os.getenv("SURAKSHA_HTTP_USER_AGENT")
    or "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36 SurakshaCompliance/1.0"
)

_HEADERS = {
    "User-Agent": _DEFAULT_UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def _headers_for_pdf_download(referer: str | None) -> dict[str, str]:
    h = {
        "User-Agent": _DEFAULT_UA,
        "Accept": "application/pdf,application/octet-stream;q=0.9,*/*;q=0.5",
    }
    if referer and referer.startswith("http"):
        h["Referer"] = referer
    return h

# RBI RSS still emits http:// links; the site serves 404 for many http URLs while https works.
_RBI_HOST_MARKER = "rbi.org.in"


def _normalize_rbi_https(url: str) -> str:
    if _RBI_HOST_MARKER not in url.lower():
        return url
    try:
        p = urlparse(url)
        if p.scheme.lower() != "http":
            return url
        netloc = p.netloc.lower()
        if netloc == "rbi.org.in":
            netloc = "www.rbi.org.in"
        elif netloc != "www.rbi.org.in":
            return url
        return urlunparse(("https", netloc, p.path, p.params, p.query, p.fragment))
    except Exception:
        return url


def _pdf_urls_from_html_raw(html: str) -> list[str]:
    """Absolute http(s) URLs ending in .pdf / .PDF embedded anywhere in HTML (incl. scripts)."""
    if not html:
        return []
    found = re.findall(
        r"https?://[^\s\"'<>]+\.pdf(?:\?[^\s\"'<>]*)?",
        html,
        flags=re.IGNORECASE,
    )
    out: list[str] = []
    seen: set[str] = set()
    for u in found:
        u = u.rstrip(").,;]")
        if u not in seen:
            seen.add(u)
            out.append(u)
    return out


def _rbi_pdf_rank(notification_url: str, pdf_url: str) -> tuple[int, str]:
    """Order PDF candidates for RBI HTML pages (notification vs press vs shared footer links)."""
    lu = pdf_url.lower()
    nu = notification_url.lower()
    path_tail = (urlparse(pdf_url).path or "").split("/")[-1].lower()

    def is_footer() -> bool:
        return path_tail.startswith("accessibility") or path_tail.startswith("utkarsh")

    if is_footer():
        return (80, lu)

    if "pressreleasedisplay" in nu or "pressrelease" in nu:
        if "/pressrelease/pdfs/" in lu:
            return (0, lu)
        if "/notification/pdfs/" in lu:
            return (5, lu)
        if "/rdocs/content/pdfs/" in lu:
            return (10, lu)
        if "rbidocs.rbi.org.in" in lu:
            return (20, lu)
        return (40, lu)

    if "notificationuser" in nu or "notification.aspx" in nu:
        if "/notification/pdfs/" in lu:
            return (0, lu)
        if "/pressrelease/pdfs/" in lu:
            return (5, lu)
        if "/rdocs/content/pdfs/" in lu:
            return (10, lu)
        if "rbidocs.rbi.org.in" in lu:
            return (20, lu)
        return (40, lu)

    # Other RBI scripts: prefer notification-style PDFs, then rbidocs
    if "/notification/pdfs/" in lu:
        return (0, lu)
    if "/pressrelease/pdfs/" in lu:
        return (2, lu)
    if "/rdocs/content/pdfs/" in lu:
        return (10, lu)
    if "rbidocs.rbi.org.in" in lu:
        return (20, lu)
    return (40, lu)


def _max_pdf_bytes() -> int:
    try:
        return int(os.getenv("SURAKSHA_PDF_MAX_BYTES", str(35 * 1024 * 1024)))
    except ValueError:
        return 35 * 1024 * 1024


def fetch_notification_html(notification_url: str, max_bytes: int = 400_000) -> str | None:
    """Fetch raw HTML for a notification page (used by LLM PDF URL fallback)."""
    notification_url = _normalize_rbi_https(notification_url)
    if not notification_url.startswith(("http://", "https://")):
        return None
    try:
        with httpx.Client(headers=_HEADERS, timeout=25.0, follow_redirects=True) as client:
            r = client.get(notification_url)
            r.raise_for_status()
            text = r.text or ""
            return text[:max_bytes]
    except Exception:
        return None


def extract_text_from_html(html: str) -> str:
    """Readable text from a notification HTML page (drops scripts/nav/footer chrome).

    Used as a fallback document body when no downloadable PDF is found, so the
    obligation extractor still has the regulator's actual circular text to work on.
    """
    if not html:
        return ""
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup(["script", "style", "noscript", "header", "footer", "nav", "form", "svg"]):
            tag.decompose()
        text = soup.get_text(separator="\n")
        lines = [ln.strip() for ln in text.splitlines()]
        return "\n".join(ln for ln in lines if ln)
    except Exception:
        return ""


def resolve_pdf_url(notification_url: str, regulator: str = "") -> Optional[str]:
    """Return a direct https URL to a PDF, or None if none found.

    If ``notification_url`` already points at a PDF, returns it unchanged.
    """
    if not notification_url or not notification_url.startswith(("http://", "https://")):
        return None
    notification_url = _normalize_rbi_https(notification_url)
    if notification_url.lower().split("?", 1)[0].endswith(".pdf"):
        return notification_url
    is_rbi = regulator.strip().upper() == "RBI" or _RBI_HOST_MARKER in notification_url.lower()
    try:
        with httpx.Client(headers=_HEADERS, timeout=25.0, follow_redirects=True) as client:
            r = client.get(notification_url)
            r.raise_for_status()
            ct = (r.headers.get("content-type") or "").lower()
            if "pdf" in ct and len(r.content) >= 4 and r.content[:4] == b"%PDF":
                return notification_url
            soup = BeautifulSoup(r.text, "html.parser")
            candidates: list[str] = []
            for a in soup.find_all("a", href=True):
                href = (a.get("href") or "").strip()
                if ".pdf" in href.lower():
                    candidates.append(urljoin(notification_url, href))
            for tag in soup.find_all(["iframe", "embed"]):
                src = (tag.get("src") or "").strip()
                if src and ".pdf" in src.lower():
                    candidates.append(urljoin(notification_url, src))
            if is_rbi:
                for raw in _pdf_urls_from_html_raw(r.text):
                    candidates.append(_normalize_rbi_https(raw))
            # Dedupe preserving order
            seen: set[str] = set()
            uniq: list[str] = []
            for c in candidates:
                if c and c not in seen:
                    seen.add(c)
                    uniq.append(c)
            candidates = uniq
            if is_rbi and candidates:
                candidates = sorted(candidates, key=lambda u: _rbi_pdf_rank(notification_url, u))
                return candidates[0]
            # Prefer same-host PDFs for other regulators
            host = urlparse(notification_url).netloc
            same_host = [c for c in candidates if urlparse(c).netloc == host]
            pool = same_host or candidates
            return pool[0] if pool else None
    except Exception:
        return None


def download_pdf(url: str, max_bytes: int | None = None, *, referer: str | None = None) -> bytes:
    """Download PDF bytes; raises on HTTP error or if body exceeds ``max_bytes``.

    ``referer`` should be the notification / listing page URL when downloading from
    hosts (e.g. RBI rbidocs) that validate Referer for direct PDF GETs.
    """
    url = _normalize_rbi_https(url)
    cap = max_bytes if max_bytes is not None else _max_pdf_bytes()
    hdr = _headers_for_pdf_download(referer)
    with httpx.Client(headers=hdr, timeout=60.0, follow_redirects=True) as client:
        with client.stream("GET", url) as r:
            r.raise_for_status()
            chunks: list[bytes] = []
            total = 0
            for part in r.iter_bytes(65536):
                total += len(part)
                if total > cap:
                    raise ValueError(f"PDF larger than cap ({cap} bytes)")
                chunks.append(part)
            data = b"".join(chunks)
            if len(data) >= 4 and data[:4] != b"%PDF":
                ct = (r.headers.get("content-type") or "").lower()
                hint = (
                    " The server likely returned an HTML page (listing, redirect, or access block) instead of a binary PDF — "
                    "try opening the notification link in a browser or attach the PDF manually."
                )
                if "html" in ct or (data[:1] == b"<" or data[:15].lower().startswith(b"<!doctype html")):
                    raise ValueError(
                        "Downloaded body is not a PDF (missing %PDF header); response looks like HTML."
                        + hint
                    )
                raise ValueError("Downloaded body is not a PDF (missing %PDF header)." + hint)
            return data


def extract_text_from_pdf_bytes(pdf_bytes: bytes) -> str:
    """Extract plain text from a digital PDF (no OCR). Empty if unreadable."""
    try:
        from io import BytesIO

        from pypdf import PdfReader

        reader = PdfReader(BytesIO(pdf_bytes))
        parts: list[str] = []
        for page in reader.pages:
            t = page.extract_text() or ""
            if t.strip():
                parts.append(t)
        return "\n\n".join(parts).strip()
    except Exception:
        return ""
