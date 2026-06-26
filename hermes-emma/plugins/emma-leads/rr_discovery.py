"""Deterministic RocketReach discovery + enrichment engine for Darryl.

The cost-optimized lead engine (no LLM in the loop -> ~0 tokens):

  RR People Search (FREE) with job_change_signal + email_grade pre-filter
    -> deterministic ICP filter (US + P&C, exclude life/health)
    -> dedup by identity / linkedin / rr_id  (BEFORE spending)
    -> metered Lookups (1 premium credit each = email+phone), gated by BOTH a
       per-run cap AND a monthly credit floor
    -> store in the leads DB.

Measured cost model (RR account watched live): search is free; only a unique
successful lookup costs ~1 premium credit; re-lookups and no-matches are free.
So ~1 credit ~= 1 delivered lead, and the only real waste is a lookup on someone
who turns out to have no contact (~10-20%), which the email_grade pre-filter
reduces. Run emits a summary with credit telemetry + a zero-yield flag.

Run directly (cron, no LLM):  python rr_discovery.py
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

try:  # package import under Hermes; flat import when run as a script/test
    from . import enrichment
except ImportError:  # pragma: no cover
    import enrichment

# ICP: US P&C insurance recent movers, target titles.
PC_TITLES = [
    "underwriter", "broker", "vice president", "regional director",
    "business development", "claims", "producer", "account executive",
    "chief underwriting", "assistant vice president",
]

# Employers/keywords to EXCLUDE — life/health-only carriers, not P&C.
EXCLUDE_EMPLOYER = [
    "life insurance", "bluecross", "blue cross", "blue shield", "healthcare",
    "health plan", "health insurance", "dental", "medicare", "medicaid",
    "unitedhealth", "uhc", "humana", "cigna", "aetna", "anthem", "aflac",
    "unum", "colonial life", "primerica", "metlife", "prudential",
    "new york life", "northwestern mutual", "guardian life", "mutual of omaha",
]

DEFAULT_WINDOWS = ["Company Change::one_month", "Company Change::three_months"]


def build_query(window: str, email_grade: str = "A-") -> dict:
    q = {
        "company_country_code": ["US"],
        "company_industry": ["Insurance"],
        "current_title": list(PC_TITLES),
        "job_change_signal": [window],
    }
    if email_grade:
        q["email_grade"] = email_grade
    return q


def is_icp(profile: dict) -> bool:
    """Deterministic ICP gate on a search profile: US + P&C (exclude life/health)."""
    cc = (profile.get("country_code") or "").upper()
    if cc and cc not in ("US", "USA"):
        return False
    emp = (profile.get("current_employer") or "").lower()
    if not emp:
        return False
    return not any(k in emp for k in EXCLUDE_EMPLOYER)


def credits_remaining(rr) -> int:
    """premium_lookup remaining, or -1 if unknown."""
    for c in (rr.account().get("credit_usage") or []):
        if c.get("credit_type") == "premium_lookup":
            r = c.get("remaining")
            return r if isinstance(r, int) else -1
    return -1


def discover(rr, windows, per_window: int = 75) -> list:
    """FREE: union of search results across job-change windows, deduped by rr id."""
    seen, out = set(), []
    for w in windows:
        q = build_query(w)
        start = 1
        while start <= per_window:
            profs = rr.search(q, order_by="relevance", page_size=25, start=start)
            if not profs:
                break
            for p in profs:
                pid = p.get("id")
                if pid and pid not in seen:
                    seen.add(pid)
                    out.append(p)
            if len(profs) < 25:
                break
            start += 25
    return out


def run(db, rr, apollo=None, max_lookups=None, credit_floor=None, windows=None, now=None) -> dict:
    """Deterministic discover -> ICP filter -> dedup -> metered lookup -> store.
    `db`/`rr`/`apollo` are duck-typed so tests inject fakes. Returns a summary."""
    now = now or datetime.now(timezone.utc)
    if max_lookups is None:
        max_lookups = _env_int("RR_MAX_LOOKUPS_PER_RUN", 25)
    if credit_floor is None:
        credit_floor = _env_int("RR_CREDIT_FLOOR", 25)
    windows = windows or DEFAULT_WINDOWS

    s = {"credits_before": None, "credits_after": None, "credits_spent": 0,
         "searched": 0, "icp_passed": 0, "new_after_dedup": 0, "looked_up": 0,
         "delivered_new": 0, "awaiting_phone": 0, "no_contact": 0,
         "capped": False, "budget_floor_hit": False, "zero_yield": False, "leads": []}

    before = credits_remaining(rr)
    s["credits_before"] = before
    budget = max(0, before - credit_floor) if before >= 0 else max_lookups
    cap = min(max_lookups, budget)
    if cap <= 0:
        s["budget_floor_hit"] = True
        s["zero_yield"] = True
        s["credits_after"] = before
        return s

    # 1. DISCOVER (free) + 2. ICP filter
    candidates = discover(rr, windows)
    s["searched"] = len(candidates)
    icp = [p for p in candidates if is_icp(p)]
    s["icp_passed"] = len(icp)

    # 3. dedup BEFORE spending (identity / linkedin)
    new = [p for p in icp
           if not db.find_existing(p.get("name") or "", p.get("current_employer") or "",
                                   p.get("linkedin_url") or "", "")]
    s["new_after_dedup"] = len(new)
    if len(new) > cap:
        s["capped"] = True

    # 4. metered lookups (the only paid step)
    for p in new[:cap]:
        res = rr.lookup({"rr_id": p.get("id"), "linkedin_url": p.get("linkedin_url")})
        s["looked_up"] += 1
        email, phone = res.get("email"), res.get("phone")
        status = "new" if (email and phone) else ("awaiting_phone" if email else "needs_human_review")
        try:
            db.upsert({
                "full_name": p.get("name"), "current_title": p.get("current_title"),
                "current_company": p.get("current_employer"), "linkedin_url": p.get("linkedin_url"),
                "email_address": email, "mobile_phone": phone, "geography": p.get("location"),
                "source_type": "rocketreach_search", "source_label": "RR job-change search",
                "source_url": p.get("linkedin_url"), "move_type": "company_change",
                "qualification_status": "qualified", "qualification_score": 80,
                "notes": "RR job_change_signal; enriched via search->lookup",
                "status_pipeline": status,
            })
        except Exception:
            pass
        if status == "new":
            s["delivered_new"] += 1
            s["leads"].append({"name": p.get("name"), "title": p.get("current_title"),
                               "company": p.get("current_employer"), "email": email, "phone": bool(phone)})
        elif status == "awaiting_phone":
            s["awaiting_phone"] += 1
        else:
            s["no_contact"] += 1

    after = credits_remaining(rr)
    s["credits_after"] = after
    if before >= 0 and after >= 0:
        s["credits_spent"] = before - after
    s["zero_yield"] = (s["delivered_new"] == 0)
    return s


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


def main():  # pragma: no cover — cron entrypoint
    import json
    try:
        from . import db as dbmod
    except ImportError:
        import db as dbmod
    rr_key = os.environ.get("ROCKETREACH_API_KEY")
    if not rr_key:
        print(json.dumps({"error": "ROCKETREACH_API_KEY not set"}))
        return
    rr = enrichment.RocketReachClient(rr_key)
    apollo_key = os.environ.get("APOLLO_API_KEY")
    apollo = enrichment.ApolloClient(apollo_key) if apollo_key else None
    summary = run(dbmod.LeadsDB(), rr, apollo)
    print(json.dumps(summary, indent=2, default=str))
    if summary.get("zero_yield"):
        print("ZERO-YIELD ALERT: this run produced 0 deliverable leads "
              "(budget_floor_hit=%s)." % summary.get("budget_floor_hit"))


if __name__ == "__main__":
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
