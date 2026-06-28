#!/usr/bin/env python3
"""Fetch 2026 regulatory RSS items, resolve PDF links, download to Desktop (or --out).

Uses the same stack as agent-service (``fetchers`` + ``pdf_ingest``). PDF downloads
require a browser-like User-Agent (see ``pdf_ingest``); RBI rbidocs also uses the
notification URL as ``Referer`` when downloading.

Run from ``agent-service`` with dependencies installed::

  cd agent-service
  pip install -r requirements.txt
  python scripts/fetch_regulatory_pdfs_2026.py
  python scripts/fetch_regulatory_pdfs_2026.py --max 25 --regulators RBI SEBI --rbi-press

Default output folder: ``%USERPROFILE%\\Desktop\\SurakshaRegulatoryPDFs2026`` (Windows)
or ``~/Desktop/SurakshaRegulatoryPDFs2026`` elsewhere.

**Supported here:** RSS/XML feeds (``RBI`` notifications, optional RBI press, ``SEBI``).
Other catalog slots (CERT-IN, NPCI, …) are HTML pages; use the in-app regulatory test
or extend this script separately.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import feedparser
import httpx

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.fetchers import DEFAULT_FEEDS, _HEADERS  # noqa: E402
from app import pdf_ingest  # noqa: E402
from app.pdf_ingest import _normalize_rbi_https  # noqa: E402


def _default_output_dir() -> Path:
    home = Path.home()
    if sys.platform == "win32":
        desk = Path(os.environ.get("USERPROFILE", str(home))) / "Desktop"
        if desk.is_dir():
            return desk / "SurakshaRegulatoryPDFs2026"
    desk = home / "Desktop"
    return (desk if desk.is_dir() else home) / "SurakshaRegulatoryPDFs2026"


def _is_year(entry: feedparser.FeedParserDict, year: int) -> bool:
    pp = getattr(entry, "published_parsed", None) or getattr(entry, "updated_parsed", None)
    if pp:
        try:
            return pp.tm_year == year
        except Exception:
            pass
    blob = " ".join(
        filter(
            None,
            [
                str(getattr(entry, "published", "") or ""),
                str(getattr(entry, "title", "") or ""),
                str(getattr(entry, "summary", "") or "")[:500],
            ],
        )
    )
    return str(year) in blob


def _slug(name: str, max_len: int = 100) -> str:
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    name = re.sub(r"\s+", "_", name.strip())[:max_len]
    return name or "item"


def _fetch_rss_xml(url: str) -> bytes:
    with httpx.Client(headers=_HEADERS, timeout=30.0, follow_redirects=True) as client:
        r = client.get(url)
        r.raise_for_status()
        return r.content


def _build_feed_jobs(regulators: list[str], rbi_press: bool) -> list[tuple[str, str, str]]:
    jobs: list[tuple[str, str, str]] = []
    known_xml = {"RBI", "SEBI"}
    for raw in regulators:
        reg = (raw or "").strip().upper()
        if not reg:
            continue
        if reg not in known_xml:
            print(
                f"[warn] '{reg}' is not wired in this script (RSS-only: {sorted(known_xml)}). "
                f"Skipping. HTML sources are in app fetchers but need a different parser path.",
            )
            continue
        if reg == "RBI":
            jobs.append(("RBI", "notifications", DEFAULT_FEEDS["RBI"]))
            if rbi_press:
                jobs.append(("RBI", "press", "https://www.rbi.org.in/pressreleases_rss.xml"))
        elif reg == "SEBI":
            jobs.append(("SEBI", "circulars", DEFAULT_FEEDS["SEBI"]))
    return jobs


def main() -> None:
    p = argparse.ArgumentParser(description="Download regulatory PDFs from live RSS (2026 filter).")
    p.add_argument("--year", type=int, default=2026, help="Filter entries for this calendar year (default 2026)")
    p.add_argument("--out", type=Path, default=None, help="Output directory (default: Desktop/SurakshaRegulatoryPDFs2026)")
    p.add_argument("--max", type=int, default=20, help="Max items to process per feed slot (default 20)")
    p.add_argument(
        "--regulators",
        nargs="*",
        default=["RBI", "SEBI"],
        help="RSS regulators to scan (default: RBI SEBI)",
    )
    p.add_argument("--rbi-press", action="store_true", help="Also scan RBI press releases RSS")
    p.add_argument("--manifest", type=Path, default=None, help="JSON manifest (default: <out>/manifest.json)")
    p.add_argument("--dry-run", action="store_true", help="Resolve PDF URLs only; do not write PDF files")
    args = p.parse_args()

    out_dir = Path(args.out) if args.out else _default_output_dir()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = args.manifest or (out_dir / "manifest.json")

    feeds = _build_feed_jobs(list(args.regulators), args.rbi_press)
    if not feeds:
        print("No RSS feeds to process. Use --regulators RBI and/or SEBI.")
        sys.exit(1)

    manifest: list[dict[str, object]] = []
    downloaded = 0
    skipped = 0
    failed = 0

    for regulator, slot, feed_url in feeds:
        print(f"\n=== {regulator} ({slot}) ===\n{feed_url}\n")
        try:
            xml = _fetch_rss_xml(feed_url)
        except Exception as e:
            print(f"[error] RSS fetch failed: {e}")
            failed += 1
            continue

        parsed = feedparser.parse(xml)
        n = 0
        for entry in parsed.entries:
            if n >= args.max:
                break
            if not _is_year(entry, args.year):
                continue

            title = (getattr(entry, "title", None) or "untitled").strip()
            link = _normalize_rbi_https((getattr(entry, "link", None) or "").strip())
            if not link.startswith("http"):
                continue

            pdf_url = pdf_ingest.resolve_pdf_url(link, regulator)
            rec: dict[str, object] = {
                "regulator": regulator,
                "slot": slot,
                "title": title,
                "notification_url": link,
                "pdf_url": pdf_url,
                "saved_path": None,
                "error": None,
            }

            if not pdf_url:
                print(f"[skip] no PDF: {title[:90]}")
                print(f"        {link}")
                rec["error"] = "no_pdf_resolved"
                manifest.append(rec)
                skipped += 1
                n += 1
                continue

            stem = _slug(f"{regulator}_{slot}_{title}")[:120]
            fname = f"{stem}.pdf"
            dest = out_dir / fname
            if dest.exists():
                print(f"[exists] {fname}")
                rec["saved_path"] = str(dest)
                manifest.append(rec)
                n += 1
                continue

            if args.dry_run:
                print(f"[dry-run] {pdf_url}\n          {title[:90]}")
                manifest.append(rec)
                n += 1
                continue

            try:
                data = pdf_ingest.download_pdf(pdf_url, referer=link)
                dest.write_bytes(data)
                print(f"[ok] {fname} ({len(data)} bytes)")
                rec["saved_path"] = str(dest)
                downloaded += 1
            except Exception as e:
                err = str(e)[:500]
                print(f"[fail] {title[:80]}\n       {err}")
                rec["error"] = err
                failed += 1

            manifest.append(rec)
            n += 1
            time.sleep(0.35)

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"\nDone. downloaded={downloaded} skipped_no_pdf={skipped} feed_errors={failed}")
    print(f"Manifest: {manifest_path}")


if __name__ == "__main__":
    main()
