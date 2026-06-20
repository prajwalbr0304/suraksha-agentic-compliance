"""TLS setup for Google GenAI / httpx on Windows and behind corporate proxies.

``google.genai`` builds ``ssl.create_default_context(cafile=certifi.where())``, which
pins the public CA bundle only and often causes::

    CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate

Import this module **before** ``google.adk`` or ``google.genai`` (see ``main.py``,
``agents.py``). ``truststore`` hooks the OS certificate store; we also strip the
forced ``cafile``/``capath`` so that store can be used.

**Last resort (dev only):** set ``SURAKSHA_INSECURE_LLM_SSL=true`` to disable TLS
verification for Gemini HTTP calls (insecure; never in production).
"""
from __future__ import annotations

import os
import ssl
import sys
from pathlib import Path

from dotenv import load_dotenv

_AGENT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_AGENT_ROOT / ".env")

_INSECURE = os.getenv("SURAKSHA_INSECURE_LLM_SSL", "false").strip().lower() in (
    "1",
    "true",
    "yes",
    "on",
)

# stdlib constructor before truststore replaces ssl.SSLContext (used for insecure ctx)
_stdlib_SSLContext = ssl.SSLContext
_orig_create_default_context = ssl.create_default_context


def _patch() -> None:
    if getattr(ssl, "_suraksha_tls_patched", False):
        return

    if not _INSECURE:
        try:
            import truststore

            truststore.inject_into_ssl()
        except Exception:
            pass

    def create_default_context_patched(*args, **kwargs):  # type: ignore[no-untyped-def]
        if _INSECURE:
            ctx = _stdlib_SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        # Let truststore / OS defaults apply instead of certifi-only CA file.
        kwargs.pop("cafile", None)
        kwargs.pop("capath", None)
        return _orig_create_default_context(*args, **kwargs)

    ssl.create_default_context = create_default_context_patched  # type: ignore[assignment]
    setattr(ssl, "_suraksha_tls_patched", True)

    # Optional: help other HTTP stacks find a bundle when not using patched path.
    if sys.platform == "win32":
        try:
            import certifi

            os.environ.setdefault("REQUESTS_CA_BUNDLE", certifi.where())
        except ImportError:
            pass


_patch()
