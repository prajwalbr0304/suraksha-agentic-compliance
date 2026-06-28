"""Environment configuration for the Suraksha ADK agent service."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load agent-service/.env even when uvicorn is started from another cwd.
_AGENT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(_AGENT_ROOT / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Local LLM via LiteLLM + Ollama (OpenAI-compatible). Set SURAKSHA_USE_LOCAL_LLM=true to bypass Gemini quota.
USE_LOCAL_LLM = os.getenv("SURAKSHA_USE_LOCAL_LLM", "false").strip().lower() in ("1", "true", "yes", "on")
LOCAL_LLM_API_BASE = (os.getenv("LOCAL_LLM_API_BASE", "http://127.0.0.1:11434") or "http://127.0.0.1:11434").rstrip("/")
# LiteLLM model id for Ollama; must match a tag from `ollama list` (e.g. llama3.2, mistral, qwen2.5).
LOCAL_LLM_MODEL = (os.getenv("LOCAL_LLM_MODEL", "ollama_chat/llama3.2") or "ollama_chat/llama3.2").strip()
if USE_LOCAL_LLM:
    os.environ.setdefault("OLLAMA_API_BASE", LOCAL_LLM_API_BASE)

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
AGENT_SHARED_SECRET = (os.getenv("AGENT_SHARED_SECRET", "") or "").strip()

AGENT_HOST = os.getenv("AGENT_HOST", "0.0.0.0")
AGENT_PORT = int(os.getenv("AGENT_PORT", "8088"))

ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "1") == "1"
WATCH_INTERVAL_MINUTES = int(os.getenv("WATCH_INTERVAL_MINUTES", "60"))
VALIDATE_INTERVAL_HOURS = int(os.getenv("VALIDATE_INTERVAL_HOURS", "24"))

# Regulatory feeds: set SURAKSHA_REGULATORY_FEED_SAMPLES=true only for offline demos.
SURAKSHA_REGULATORY_FEED_SAMPLES = os.getenv("SURAKSHA_REGULATORY_FEED_SAMPLES", "false").strip().lower() in (
    "1", "true", "yes", "on",
)
# PDF ingestion: require a successful PDF download before creating obligations (strict).
AUTOMATIC_PDF_STRICT = os.getenv("AUTOMATIC_PDF_STRICT", "false").strip().lower() in ("1", "true", "yes", "on")
DOCUMENTS_BUCKET = os.getenv("NEXT_PUBLIC_SUPABASE_DOCUMENTS_BUCKET", "compliance-documents")
try:
    PDF_MIN_TEXT_CHARS = int(os.getenv("SURAKSHA_PDF_MIN_TEXT_CHARS", "200"))
except ValueError:
    PDF_MIN_TEXT_CHARS = 200

# Per-change LLM fan-out limits (each obligation does map + assign calls).
try:
    MAX_OBLIGATIONS_PER_CHANGE = max(1, int(os.getenv("SURAKSHA_MAX_OBLIGATIONS_PER_CHANGE", "5")))
except ValueError:
    MAX_OBLIGATIONS_PER_CHANGE = 5
try:
    MAX_REGULATORY_CHANGES_PER_FULL_RUN = max(1, int(os.getenv("SURAKSHA_MAX_REGULATORY_CHANGES_PER_FULL_RUN", "5")))
except ValueError:
    MAX_REGULATORY_CHANGES_PER_FULL_RUN = 5
try:
    MAX_MAPS_PER_OBLIGATION = max(1, int(os.getenv("SURAKSHA_MAX_MAPS_PER_OBLIGATION", "2")))
except ValueError:
    MAX_MAPS_PER_OBLIGATION = 2

# Parallel PDF text → obligation extraction (large circulars). Off by default.
PDF_CHUNK_EXTRACTION = os.getenv("SURAKSHA_PDF_CHUNK_EXTRACTION", "false").strip().lower() in ("1", "true", "yes", "on")
try:
    PDF_CHUNK_CHARS = max(2000, int(os.getenv("SURAKSHA_PDF_CHUNK_CHARS", "7000")))
except ValueError:
    PDF_CHUNK_CHARS = 7000
try:
    PDF_CHUNK_MIN_SPLIT_CHARS = max(5000, int(os.getenv("SURAKSHA_PDF_CHUNK_MIN_SPLIT_CHARS", "12000")))
except ValueError:
    PDF_CHUNK_MIN_SPLIT_CHARS = 12000
try:
    PDF_CHUNK_PARALLEL_MAX = max(1, min(6, int(os.getenv("SURAKSHA_PDF_CHUNK_PARALLEL_MAX", "2"))))
except ValueError:
    PDF_CHUNK_PARALLEL_MAX = 2
try:
    _RAW_AGENT_TIMEOUT = os.getenv("SURAKSHA_AGENT_LLM_TIMEOUT_SEC", "").strip()
    if _RAW_AGENT_TIMEOUT:
        AGENT_LLM_TIMEOUT_SEC = max(15.0, float(_RAW_AGENT_TIMEOUT))
    elif USE_LOCAL_LLM:
        # Local Ollama is much slower than Gemini; 180s per agent causes asyncio.wait_for to cancel ADK runs
        # ("Root node … was cancelled") and skips drift/impact/audit persistence.
        AGENT_LLM_TIMEOUT_SEC = 900.0
    else:
        AGENT_LLM_TIMEOUT_SEC = 180.0
except ValueError:
    AGENT_LLM_TIMEOUT_SEC = 900.0 if USE_LOCAL_LLM else 180.0

# LiteLLM -> Ollama HTTP read timeout (seconds). Litellm defaults to ~600s, which is shorter than
# ``AGENT_LLM_TIMEOUT_SEC`` for local runs and causes ``httpx.ReadTimeout`` / ``litellm.Timeout`` mid-call.
try:
    _RAW_LITELLM_HTTP = os.getenv("SURAKSHA_LITELLM_HTTP_TIMEOUT_SEC", "").strip()
    if _RAW_LITELLM_HTTP:
        LITELLM_HTTP_TIMEOUT_SEC = max(60.0, float(_RAW_LITELLM_HTTP))
    elif USE_LOCAL_LLM:
        LITELLM_HTTP_TIMEOUT_SEC = max(1800.0, AGENT_LLM_TIMEOUT_SEC * 2 + 300.0)
    else:
        LITELLM_HTTP_TIMEOUT_SEC = 120.0
except ValueError:
    LITELLM_HTTP_TIMEOUT_SEC = max(1800.0, AGENT_LLM_TIMEOUT_SEC * 2 + 300.0) if USE_LOCAL_LLM else 120.0

# Dev: only scan RBI RSS when org has no custom sources (uses DEFAULT_FEEDS fallback).
REGULATORY_FEEDS_RBI_ONLY = os.getenv("SURAKSHA_REGULATORY_FEEDS_RBI_ONLY", "false").strip().lower() in (
    "1", "true", "yes", "on",
)

# Regulation Center: split ingest vs compliance processing (coordinator + pipeline).
REGULATION_CENTER_ENABLED = os.getenv("REGULATION_CENTER_ENABLED", "true").strip().lower() in (
    "1", "true", "yes", "on",
)
REGULATION_AUTO_PROCESS = os.getenv("REGULATION_AUTO_PROCESS", "true").strip().lower() in (
    "1", "true", "yes", "on",
)
REGULATION_APPROVAL_REQUIRED_DEFAULT = os.getenv("REGULATION_APPROVAL_REQUIRED_DEFAULT", "false").strip().lower() in (
    "1", "true", "yes", "on",
)
PDF_URL_LLM_FALLBACK = os.getenv("SURAKSHA_PDF_URL_LLM_FALLBACK", "true").strip().lower() in (
    "1", "true", "yes", "on",
)
# Post-ingest LLM tagging (category, tags, executive_summary) for Regulation Center inbox.
REGULATION_TAGGER_ENABLED = os.getenv("SURAKSHA_REGULATION_TAGGER", "true").strip().lower() in (
    "1", "true", "yes", "on",
)
# APScheduler tick for per-source feed scans (minutes). Each tick checks which sources are due.
try:
    REGULATION_SCHEDULER_TICK_MINUTES = max(1, int(os.getenv("REGULATION_SCHEDULER_TICK_MINUTES", "5")))
except ValueError:
    REGULATION_SCHEDULER_TICK_MINUTES = 5

if GEMINI_API_KEY and not USE_LOCAL_LLM:
    os.environ.setdefault("GOOGLE_API_KEY", GEMINI_API_KEY)
    os.environ.setdefault("GOOGLE_GENAI_USE_VERTEXAI", "FALSE")


def llm_available() -> bool:
    if USE_LOCAL_LLM:
        return True
    return bool(GEMINI_API_KEY)


def llm_backend() -> str:
    return "local_litellm" if USE_LOCAL_LLM else "gemini"


def llm_model_label() -> str:
    return LOCAL_LLM_MODEL if USE_LOCAL_LLM else GEMINI_MODEL
