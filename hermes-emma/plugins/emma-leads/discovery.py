"""
P&C people-moves discovery via RSS feeds.

The fix for Darryl's redundancy: instead of re-ranking the same 60-day pool with
relevance-sorted keyword searches every morning (which re-surfaces the same
people for weeks), ingest dedicated chronological "people on the move" feeds
NEWEST-FIRST and advance a per-feed date watermark — so each run yields only
what published since the last run. Net-new by construction, near-zero
redundancy, zero keyword-search budget.

Parsing uses stdlib xml.etree (RSS 2.0 + basic Atom) — no third-party dep.
Ported from the validated YALC reference (src/lib/discovery/feeds.ts).
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Callable, Optional

try:  # package context (inside Hermes)
    from .db import is_newer_than_watermark
except ImportError:  # standalone (tests run from the plugin dir)
    from db import is_newer_than_watermark

# ─── curated P&C feed registry (research-verified, free) ─────────────────────

PC_PEOPLE_MOVE_FEEDS = [
    {"source_key": "carrier_management_execs", "purity": "pure",
     "name": "Carrier Management — Executives on the Move",
     "url": "https://www.carriermanagement.com/executive-profiles/executive-moves/feed/"},
    {"source_key": "insurance_journal_people", "purity": "high",
     "name": "Insurance Journal — People Moves",
     "url": "https://www.insurancejournal.com/topics/people-moves/feed/"},
    {"source_key": "risk_and_insurance_people", "purity": "high",
     "name": "Risk & Insurance — People on the Move",
     "url": "https://riskandinsurance.com/category/profession/people-on-the-move/feed/"},
    {"source_key": "reinsurance_news_people", "purity": "medium",
     "name": "Reinsurance News — People Moves",
     "url": "https://www.reinsurancene.ws/tag/people-moves/feed/"},
    {"source_key": "insurance_business_america", "purity": "medium",
     "name": "Insurance Business America",
     "url": "https://www.insurancebusinessmag.com/us/rss/"},
    {"source_key": "propertycasualty360", "purity": "medium",
     "name": "PropertyCasualty360",
     "url": "https://www.propertycasualty360.com/rss/"},
]

_ATOM = "{http://www.w3.org/2005/Atom}"


def _text(el) -> str:
    return (el.text or "").strip() if el is not None else ""


def to_iso(date_str: str) -> Optional[str]:
    if not date_str:
        return None
    try:  # RFC 822 (RSS pubDate)
        return parsedate_to_datetime(date_str).isoformat()
    except Exception:
        pass
    try:  # ISO 8601 (Atom)
        from datetime import datetime
        return datetime.fromisoformat(date_str.replace("Z", "+00:00")).isoformat()
    except Exception:
        return None


def parse_feed(xml: str, source_key: str, source_label: str = "") -> list:
    """Parse RSS 2.0 or Atom into normalized items. Returns [] on bad XML."""
    try:
        root = ET.fromstring(xml.strip())
    except ET.ParseError:
        return []

    items = []
    # RSS 2.0
    channel = root.find("channel")
    if channel is not None:
        for it in channel.findall("item"):
            link = _text(it.find("link"))
            items.append({
                "source_key": source_key, "source_label": source_label,
                "title": _text(it.find("title")),
                "link": link,
                "guid": _text(it.find("guid")) or link,
                "published_at": to_iso(_text(it.find("pubDate"))),
                "summary": _text(it.find("description")),
            })
        return items

    # Atom
    if root.tag == f"{_ATOM}feed":
        for en in root.findall(f"{_ATOM}entry"):
            link = ""
            for ln in en.findall(f"{_ATOM}link"):
                rel = ln.get("rel", "alternate")
                if rel == "alternate" and ln.get("href"):
                    link = ln.get("href")
                    break
            if not link:
                ln = en.find(f"{_ATOM}link")
                link = ln.get("href") if ln is not None else ""
            items.append({
                "source_key": source_key, "source_label": source_label,
                "title": _text(en.find(f"{_ATOM}title")),
                "link": link,
                "guid": _text(en.find(f"{_ATOM}id")) or link,
                "published_at": to_iso(_text(en.find(f"{_ATOM}published")) or _text(en.find(f"{_ATOM}updated"))),
                "summary": _text(en.find(f"{_ATOM}summary")) or _text(en.find(f"{_ATOM}content")),
            })
    return items


def _default_fetch(url: str) -> str:
    import httpx
    with httpx.Client(timeout=25.0, follow_redirects=True) as c:
        r = c.get(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; EmmaResearchBot/1.0; +https://mindlink.tech)",
            "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml",
        })
        r.raise_for_status()
        return r.text


def poll_feed(db, feed: dict, fetch: Callable[[str], str] = _default_fetch) -> dict:
    """Return ONLY items new since last run; advance watermark; record seen URLs.
    Never raises — a broken feed returns an error in the result."""
    try:
        xml = fetch(feed["url"])
    except Exception as e:
        return {"source_key": feed["source_key"], "name": feed["name"],
                "total": 0, "new_items": [], "error": str(e)}

    items = parse_feed(xml, feed["source_key"], feed["name"])
    watermark = db.get_watermark(feed["source_key"])

    new_items = []
    newest = None
    for it in items:
        pub = it.get("published_at")
        if pub and (newest is None or pub > newest):
            newest = pub
        seen = bool(it.get("link")) and db.url_seen(it["link"])
        fresh = (not seen) and (pub is None or is_newer_than_watermark(pub, watermark))
        if fresh:
            new_items.append(it)
            if it.get("link"):
                db.record_url(it["link"], feed["name"])

    if newest:
        db.set_watermark(feed["source_key"], newest, feed["name"])

    return {"source_key": feed["source_key"], "name": feed["name"],
            "total": len(items), "new_items": new_items, "newest": newest}


def poll_all(db, feeds: Optional[list] = None, fetch: Callable[[str], str] = _default_fetch) -> dict:
    feeds = feeds if feeds is not None else PC_PEOPLE_MOVE_FEEDS
    results = [poll_feed(db, f, fetch) for f in feeds]
    new_items = [it for r in results for it in r.get("new_items", [])]
    return {"results": results, "new_items": new_items, "new_count": len(new_items)}
