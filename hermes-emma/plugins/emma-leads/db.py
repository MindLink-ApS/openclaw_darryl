"""
Leads database + dedup ledger (SQLite, stdlib).

This is the engine backbone: it stores P&C move candidates and validated leads,
deduplicates BEFORE spending the scrape/enrich budget (the fix to Darryl's
redundant-leads complaint), and enforces the delivery gate (email AND phone).

Dedup keys (exact, indexed — never the fuzzy matchers that false-drop):
  - identity_key = sha1(normalized name + normalized NEW company)  ← job-changers
  - linkedin_url (normalized)
  - email (normalized)
Plus a seen_urls ledger (skip re-scraping articles) and per-feed date
watermarks (process only what's new since last run).

Algorithms ported from the validated YALC reference (src/lib/mining/ledger.ts).
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Optional

# ─── normalization / identity (pure) ─────────────────────────────────────────

_LEGAL_SUFFIXES = {"inc", "llc", "corp", "co", "company", "group", "ltd", "plc", "holdings", "the"}


def normalize_name(s: Optional[str]) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def normalize_company(s: Optional[str]) -> str:
    toks = [t for t in normalize_name(s).split(" ") if t]
    kept = [t for t in toks if t not in _LEGAL_SUFFIXES]
    return " ".join(kept or toks)


def person_identity_key(name: Optional[str], company: Optional[str]) -> str:
    n = normalize_name(name)
    if not n:
        return ""
    c = normalize_company(company)
    return hashlib.sha1(f"{n}|{c}".encode()).hexdigest()


def normalize_linkedin(url: Optional[str]) -> str:
    if not url:
        return ""
    u = url.strip().lower()
    u = re.sub(r"^https?://(www\.)?", "", u)
    u = re.sub(r"[?#].*$", "", u).rstrip("/")
    return u


def normalize_email(e: Optional[str]) -> str:
    return (e or "").strip().lower()


def normalize_url(url: Optional[str]) -> str:
    if not url:
        return ""
    u = url.strip().lower()
    u = re.sub(r"^https?://(www\.)?", "", u)
    u = re.sub(r"[?#].*$", "", u).rstrip("/")
    return u


def hash_url(url: Optional[str]) -> str:
    return hashlib.sha1(normalize_url(url).encode()).hexdigest()


def is_newer_than_watermark(entry_date: Optional[str], watermark: Optional[str]) -> bool:
    if not entry_date:
        return False
    if not watermark:
        return True
    return entry_date > watermark  # ISO 8601 strings sort chronologically


# CSV columns Darryl receives (exact order).
CSV_COLUMNS = [
    "full_name", "current_title", "current_company", "company_hq_address",
    "email_address", "mobile_phone", "linkedin_url", "source_label", "source_url",
    "source_published_date", "move_effective_date", "move_type", "geography",
    "functional_focus", "notes", "status_pipeline",
]

# Valid pipeline statuses.
PIPELINE_STATUSES = {
    "candidate", "new", "awaiting_phone", "queued_for_outreach",
    "contacted", "in_conversation", "do_not_contact", "needs_human_review",
}


def default_db_path() -> str:
    home = os.environ.get("HERMES_HOME") or os.path.join(os.path.expanduser("~"), ".hermes")
    return os.path.join(home, "emma-leads.db")


class LeadsDB:
    def __init__(self, path: Optional[str] = None):
        self.path = path or default_db_path()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self._migrate()

    def _migrate(self) -> None:
        self.conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS leads (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              identity_key TEXT,
              full_name TEXT,
              current_title TEXT,
              current_company TEXT,
              company_domain TEXT,
              company_hq_address TEXT,
              linkedin_url TEXT,
              email_address TEXT,
              mobile_phone TEXT,
              geography TEXT,
              functional_focus TEXT,
              move_type TEXT,
              move_effective_date TEXT,
              source_type TEXT,
              source_label TEXT,
              source_url TEXT,
              source_published_date TEXT,
              notes TEXT,
              qualification_score INTEGER,
              qualification_status TEXT,
              status_pipeline TEXT NOT NULL DEFAULT 'candidate',
              contact_count INTEGER NOT NULL DEFAULT 0,
              last_contacted_at TEXT,
              next_follow_up TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now')),
              delivered_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_leads_identity ON leads(identity_key);
            CREATE INDEX IF NOT EXISTS idx_leads_linkedin ON leads(linkedin_url);
            CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email_address);
            CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status_pipeline);

            CREATE TABLE IF NOT EXISTS seen_urls (
              url_hash TEXT PRIMARY KEY,
              url TEXT,
              source_label TEXT,
              first_seen_at TEXT DEFAULT (datetime('now')),
              times_seen INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS source_watermarks (
              source_key TEXT PRIMARY KEY,
              label TEXT,
              last_published_date TEXT,
              last_run_at TEXT
            );
            """
        )
        self.conn.commit()

    # ── dedup ───────────────────────────────────────────────────────────────

    def find_existing(self, name: str, company: str, linkedin_url: str = "", email: str = "") -> Optional[sqlite3.Row]:
        idk = person_identity_key(name, company)
        li = normalize_linkedin(linkedin_url)
        em = normalize_email(email)
        cur = self.conn.execute(
            """SELECT * FROM leads
               WHERE (identity_key != '' AND identity_key = ?)
                  OR (? != '' AND linkedin_url = ?)
                  OR (? != '' AND email_address = ?)
               LIMIT 1""",
            (idk, li, li, em, em),
        )
        return cur.fetchone()

    def dedup_check(self, people: list) -> dict:
        """Split a list of {name, company, linkedin_url?, email?} into new vs seen.
        Call BEFORE spending scrape/enrich budget."""
        new, seen = [], []
        for p in people:
            row = self.find_existing(
                p.get("name", ""), p.get("company", ""),
                p.get("linkedin_url", ""), p.get("email", ""),
            )
            (seen if row else new).append(p)
        return {"new": new, "seen": seen, "new_count": len(new), "seen_count": len(seen)}

    # ── seen URLs ───────────────────────────────────────────────────────────

    def url_seen(self, url: str) -> bool:
        cur = self.conn.execute("SELECT 1 FROM seen_urls WHERE url_hash = ?", (hash_url(url),))
        return cur.fetchone() is not None

    def record_url(self, url: str, source_label: str = "") -> None:
        h = hash_url(url)
        self.conn.execute(
            """INSERT INTO seen_urls(url_hash, url, source_label) VALUES(?,?,?)
               ON CONFLICT(url_hash) DO UPDATE SET times_seen = times_seen + 1,
               first_seen_at = first_seen_at""",
            (h, url, source_label),
        )
        self.conn.commit()

    # ── watermarks ──────────────────────────────────────────────────────────

    def get_watermark(self, source_key: str) -> Optional[str]:
        cur = self.conn.execute("SELECT last_published_date FROM source_watermarks WHERE source_key = ?", (source_key,))
        row = cur.fetchone()
        return row["last_published_date"] if row else None

    def set_watermark(self, source_key: str, iso_date: str, label: str = "") -> None:
        self.conn.execute(
            """INSERT INTO source_watermarks(source_key, label, last_published_date, last_run_at)
               VALUES(?,?,?,datetime('now'))
               ON CONFLICT(source_key) DO UPDATE SET last_published_date=excluded.last_published_date,
               last_run_at=datetime('now'), label=excluded.label""",
            (source_key, label, iso_date),
        )
        self.conn.commit()

    # ── leads CRUD ──────────────────────────────────────────────────────────

    def upsert(self, fields: dict) -> int:
        """Insert or update a lead keyed on identity. Returns the lead id.
        Recomputes status_pipeline from completeness unless explicitly set."""
        name = fields.get("full_name") or fields.get("name") or ""
        company = fields.get("current_company") or fields.get("company") or ""
        idk = person_identity_key(name, company)
        existing = self.find_existing(name, company, fields.get("linkedin_url", ""), fields.get("email_address", ""))

        row = {
            "identity_key": idk,
            "full_name": name or None,
            "current_title": fields.get("current_title") or fields.get("title"),
            "current_company": company or None,
            "company_domain": fields.get("company_domain"),
            "company_hq_address": fields.get("company_hq_address"),
            "linkedin_url": normalize_linkedin(fields.get("linkedin_url", "")) or None,
            "email_address": normalize_email(fields.get("email_address", "")) or None,
            "mobile_phone": fields.get("mobile_phone"),
            "geography": fields.get("geography"),
            "functional_focus": fields.get("functional_focus"),
            "move_type": fields.get("move_type"),
            "move_effective_date": fields.get("move_effective_date"),
            "source_type": fields.get("source_type"),
            "source_label": fields.get("source_label"),
            "source_url": fields.get("source_url"),
            "source_published_date": fields.get("source_published_date"),
            "notes": fields.get("notes"),
            "qualification_score": fields.get("qualification_score"),
            "qualification_status": fields.get("qualification_status"),
        }

        # Status: explicit > derived-from-completeness (on the MERGED record),
        # but never auto-override an advanced lifecycle status.
        _PROTECTED = {"queued_for_outreach", "contacted", "in_conversation", "do_not_contact"}
        status = fields.get("status_pipeline")
        if not status:
            existing_status = existing["status_pipeline"] if existing else None
            if existing_status in _PROTECTED:
                status = existing_status
            else:
                eff_email = row["email_address"] or (existing["email_address"] if existing else None)
                eff_phone = row["mobile_phone"] or (existing["mobile_phone"] if existing else None)
                status = "new" if (eff_email and eff_phone) else ("awaiting_phone" if eff_email else "candidate")
        row["status_pipeline"] = status

        if existing:
            # Update only the non-null incoming fields (don't clobber known data).
            sets, vals = [], []
            for k, v in row.items():
                if v is not None:
                    sets.append(f"{k} = ?")
                    vals.append(v)
            sets.append("updated_at = datetime('now')")
            vals.append(existing["id"])
            self.conn.execute(f"UPDATE leads SET {', '.join(sets)} WHERE id = ?", vals)
            self.conn.commit()
            return existing["id"]
        else:
            cols = list(row.keys())
            cur = self.conn.execute(
                f"INSERT INTO leads({', '.join(cols)}) VALUES({', '.join('?' * len(cols))})",
                [row[c] for c in cols],
            )
            self.conn.commit()
            return cur.lastrowid

    def candidate_upsert(self, fields: dict) -> int:
        """Store a pre-enrichment candidate (gate stage). Never sets a delivered status."""
        fields = dict(fields)
        fields.setdefault("source_type", "web")
        fields["status_pipeline"] = "candidate"
        return self.upsert(fields)

    def get(self, lead_id: int) -> Optional[dict]:
        cur = self.conn.execute("SELECT * FROM leads WHERE id = ?", (lead_id,))
        row = cur.fetchone()
        return dict(row) if row else None

    def search(self, status: Optional[str] = None, company: Optional[str] = None, limit: int = 200) -> list:
        q = "SELECT * FROM leads WHERE 1=1"
        args: list = []
        if status:
            q += " AND status_pipeline = ?"
            args.append(status)
        if company:
            q += " AND current_company LIKE ?"
            args.append(f"%{company}%")
        q += " ORDER BY created_at DESC LIMIT ?"
        args.append(limit)
        return [dict(r) for r in self.conn.execute(q, args).fetchall()]

    def stats(self) -> dict:
        rows = self.conn.execute(
            "SELECT status_pipeline, COUNT(*) n FROM leads GROUP BY status_pipeline"
        ).fetchall()
        by_status = {r["status_pipeline"]: r["n"] for r in rows}
        return {"total": sum(by_status.values()), "by_status": by_status}

    def update_pipeline(self, lead_id: int, status: str, reason: str = "") -> bool:
        if status not in PIPELINE_STATUSES:
            return False
        note_clause, args = "", [status]
        if reason:
            note_clause = ", notes = COALESCE(notes || ' | ', '') || ?"
            args.append(f"status→{status}: {reason}")
        args.append(lead_id)
        cur = self.conn.execute(
            f"UPDATE leads SET status_pipeline = ?{note_clause}, updated_at = datetime('now') WHERE id = ?",
            args,
        )
        self.conn.commit()
        return cur.rowcount > 0

    def record_contact(self, lead_id: int, follow_up_days: int = 7) -> bool:
        cur = self.conn.execute(
            """UPDATE leads SET contact_count = contact_count + 1,
               last_contacted_at = datetime('now'),
               next_follow_up = datetime('now', ? || ' days'),
               updated_at = datetime('now') WHERE id = ?""",
            (f"+{follow_up_days}", lead_id),
        )
        self.conn.commit()
        return cur.rowcount > 0

    def export_csv(self, out_path: str, status: Optional[str] = None) -> dict:
        """Export ONLY delivery-ready leads (BOTH email AND phone) — Darryl's gate."""
        import csv

        q = ("SELECT * FROM leads WHERE email_address IS NOT NULL AND email_address != '' "
             "AND mobile_phone IS NOT NULL AND mobile_phone != ''")
        args: list = []
        if status:
            q += " AND status_pipeline = ?"
            args.append(status)
        q += " ORDER BY created_at DESC"
        rows = self.conn.execute(q, args).fetchall()

        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(CSV_COLUMNS)
            for r in rows:
                w.writerow([r[c] if c in r.keys() else "" for c in CSV_COLUMNS])
        return {"path": out_path, "rows": len(rows)}

    def close(self) -> None:
        self.conn.close()


# Module-level singleton for tool handlers (one DB per process).
_db: Optional[LeadsDB] = None


def get_db() -> LeadsDB:
    global _db
    if _db is None:
        _db = LeadsDB()
    return _db
