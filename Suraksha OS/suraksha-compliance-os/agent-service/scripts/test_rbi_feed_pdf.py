#!/usr/bin/env python3
"""Offline check: RBI RSS -> notification URLs -> PDF resolution -> optional text sample.

Run from ``agent-service`` (with venv activated):

  python scripts/test_rbi_feed_pdf.py --limit 5
  python scripts/test_rbi_feed_pdf.py --feed press --limit 5
  python scripts/test_rbi_feed_pdf.py --find-pdf --scan 25 --download

RBI RSS often lists ``http://www.rbi.org.in/...`` links; the live site responds **404** for many
HTTP URLs while **HTTPS** works. The pipeline normalizes these in ``fetch_feed`` / ``pdf_ingest``.

Does **not** call Supabase or the LLM.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.fetchers import DEFAULT_FEEDS, fetch_feed  # noqa: E402
from app import pdf_ingest  # noqa: E402

RBI_FEED_URLS = {
    "notifications": DEFAULT_FEEDS.get("RBI") or "https://www.rbi.org.in/notifications_rss.xml",
    "press": "https://www.rbi.org.in/pressreleases_rss.xml",
}


def _configure_stdio() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass


def main() -> None:
    _configure_stdio()
    p = argparse.ArgumentParser(description="Probe RBI RSS items for PDF links and text extraction.")
    p.add_argument(
        "--feed",
        choices=sorted(RBI_FEED_URLS.keys()),
        default="notifications",
        help="Which RBI XML feed to use (default: notifications)",
    )
    p.add_argument("--limit", type=int, default=5, help="RSS entries to inspect (default 5)")
    p.add_argument(
        "--scan",
        type=int,
        default=0,
        help="With --find-pdf: max RSS entries to walk (default: max(30, 3 × --limit))",
    )
    p.add_argument(
        "--find-pdf",
        action="store_true",
        help="Stop after the first entry that resolves to a PDF (still prints each entry up to that point)",
    )
    p.add_argument(
        "--download",
        action="store_true",
        help="Download the first resolved PDF (size-capped) and print a text sample",
    )
    args = p.parse_args()

    feed_url = RBI_FEED_URLS[args.feed]
    print(f"Feed: RBI ({args.feed})\nURL: {feed_url}\n")

    fetch_n = max(1, args.limit)
    if args.find_pdf:
        fetch_n = args.scan if args.scan > 0 else max(30, args.limit * 3)

    items = fetch_feed("RBI", feed_url, limit=fetch_n)
    if not items:
        print("No items returned. Network blocked, empty parse, or samples disabled.")
        print("Tip: set SURAKSHA_REGULATORY_FEED_SAMPLES=true in .env only for offline demos.")
        sys.exit(2)

    show_cap = fetch_n if args.find_pdf else max(1, args.limit)
    downloaded = False

    for i, it in enumerate(items[:show_cap], 1):
        title = it.get("title", "")
        link = it.get("url", "")
        summary = (it.get("summary") or "")[:200].replace("\n", " ")
        print(f"--- Entry {i} ---")
        print(f"title: {title}")
        print(f"link:  {link}")
        print(f"summary (200 chars): {summary!r}")

        pdf = pdf_ingest.resolve_pdf_url(link, "RBI")
        if pdf:
            print(f"pdf:   {pdf}")
        else:
            print("pdf:   (none — HTML-only page, blocked fetch, or no PDF on page)")

        if args.download and pdf and not downloaded:
            print()
            _try_download(pdf, link)
            downloaded = True
            if args.find_pdf:
                print(f"\n[find-pdf] Stopped at entry {i}.")
                return

        print()

        if args.find_pdf and pdf:
            if not args.download:
                print(f"[find-pdf] Stopped at entry {i}.")
            return

    if args.find_pdf:
        print(f"[find-pdf] No PDF resolved within first {min(show_cap, len(items))} entries.")
        sys.exit(3)


def _try_download(pdf: str, referer: str) -> None:
    try:
        cap = 5 * 1024 * 1024
        data = pdf_ingest.download_pdf(pdf, max_bytes=cap, referer=referer)
        text = pdf_ingest.extract_text_from_pdf_bytes(data)
        print(f"[download] bytes={len(data)} text_chars={len(text)}")
        print("text sample:\n", text[:800] if text else "(empty)")
    except Exception as e:
        print(f"[download] FAILED: {e}")


if __name__ == "__main__":
    main()
