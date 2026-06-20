"""Hosts allowed for LLM-resolved PDF URLs (must stay aligned with catalog allowlists)."""
from __future__ import annotations

from urllib.parse import urlparse

_ALLOWED_HOSTS = frozenset(
    {
        "www.rbi.org.in",
        "rbi.org.in",
        "rbidocs.rbi.org.in",
        "www.sebi.gov.in",
        "sebi.gov.in",
        "www.cert-in.org.in",
        "cert-in.org.in",
        "www.npci.org.in",
        "npci.org.in",
        "uidai.gov.in",
        "www.uidai.gov.in",
    }
)


def is_allowed_regulator_pdf_url(url: str) -> bool:
    try:
        p = urlparse(url.strip())
        if p.scheme not in ("http", "https"):
            return False
        host = (p.netloc or "").lower().split(":")[0]
        if host in _ALLOWED_HOSTS:
            return True
        if host.endswith(".rbi.org.in") or host.endswith(".sebi.gov.in"):
            return True
        return False
    except Exception:
        return False
