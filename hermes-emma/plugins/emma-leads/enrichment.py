"""
Contact enrichment — RocketReach (primary) → Apollo (fallback) waterfall.

Emma discovers WHO moved (RSS feeds / job-change search); this module gets the
email + phone for a person already found. The waterfall maximizes the hit rate
for Darryl's strict delivery bar: a lead ships ONLY with BOTH a verified email
AND a usable phone.

  1. RocketReach lookup (primary) — owned, returns email + phone + LinkedIn.
  2. Apollo match (fallback) — fills whatever RocketReach missed.
  3. Delivery gate — status 'new' only if both land, else 'awaiting_phone' /
     'needs_human_review' (held, never delivered).

The HTTP layer is injected (`transport`) so the logic is unit-tested offline.
"""

from __future__ import annotations

from typing import Any, Callable, Optional
import time

# A transport is: (method, url, headers, params, json_body) -> (status_code, parsed_json)
Transport = Callable[..., "tuple[int, dict]"]

ROCKETREACH_BASE = "https://api.rocketreach.co/api/v2"
APOLLO_BASE = "https://api.apollo.io/api/v1"

# RocketReach + Apollo sit behind Cloudflare, which rejects the default
# python-httpx/urllib user-agent with HTTP 403 "error code: 1010" (bot block).
# Sending a normal browser UA fixes it — this was the cause of zero successful
# RocketReach lookups (the API key itself is valid).
_UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
       "Chrome/120.0.0.0 Safari/537.36")


# ─── helpers (pure, unit-tested) ─────────────────────────────────────────────

def pick_best_email(emails: list) -> Optional[dict]:
    """Prefer SMTP-valid professional, then any valid, then the first."""
    if not emails:
        return None
    norm = [e for e in emails if isinstance(e, dict) and e.get("email")]
    if not norm:
        return None
    return (
        next((e for e in norm if e.get("smtp_valid") == "valid" and e.get("type") == "professional"), None)
        or next((e for e in norm if e.get("smtp_valid") == "valid"), None)
        or norm[0]
    )


def pick_phone(phones: list) -> Optional[str]:
    """Prefer the recommended phone; fall back to the first e164/number."""
    if not phones:
        return None
    out = []
    recommended = None
    for p in phones:
        if isinstance(p, dict):
            num = str(p.get("e164") or p.get("number") or p.get("sanitized_number") or "").strip()
            if p.get("recommended") and not recommended:
                recommended = num
        else:
            num = str(p).strip()
        if num:
            out.append(num)
    return recommended or (out[0] if out else None)


def apply_delivery_gate(email: Optional[str], phone: Optional[str]) -> str:
    """Darryl's gate: deliver only with BOTH. Otherwise hold."""
    if email and phone:
        return "new"
    if email and not phone:
        return "awaiting_phone"  # email found, phone pending — NOT delivered
    return "needs_human_review"


# ─── default transport (httpx) ───────────────────────────────────────────────

def _default_transport(method: str, url: str, headers: dict, params=None, json_body=None):
    import httpx
    h = {"User-Agent": _UA}
    if headers:
        h.update(headers)
    with httpx.Client(timeout=30.0) as client:
        resp = client.request(method, url, headers=h, params=params, json=json_body)
        try:
            data = resp.json()
        except Exception:
            data = {}
        return resp.status_code, data


# ─── RocketReach (primary) ───────────────────────────────────────────────────

class RocketReachClient:
    def __init__(self, api_key: str, transport: Optional[Transport] = None, poll_attempts: int = 4, poll_wait: float = 2.0):
        self.api_key = api_key
        self._t = transport or _default_transport
        self.poll_attempts = poll_attempts
        self.poll_wait = poll_wait

    def _headers(self) -> dict:
        return {"Api-Key": self.api_key, "Content-Type": "application/json"}

    def search(self, query: dict, order_by: str = "relevance", page_size: int = 5, start: int = 1) -> list:
        """POST /person/search — a list of matching profiles (id, name, current_title,
        current_employer, linkedin_url, teaser; NO full contact info). This is the
        reliable way to resolve a person to an RR id: the direct name+employer lookup
        404s for anyone RR can't uniquely match, but search returns candidates."""
        body = {"query": query, "order_by": order_by, "page_size": page_size, "start": start}
        sc, data = self._t("POST", f"{ROCKETREACH_BASE}/person/search", self._headers(), json_body=body)
        if sc >= 400 or not isinstance(data, dict):
            return []
        return data.get("profiles") or []

    def _resolve_id(self, person: dict):
        """Resolve a person to an RR profile id by searching name + current_employer.
        Returns None if RR has no confident match (we do NOT fall back to a name-only
        search — a wrong match would ship a wrong contact)."""
        name, company = person.get("name"), person.get("company")
        if not (name and company):
            return None
        profs = self.search({"name": [name], "current_employer": [company]})
        return profs[0].get("id") if profs else None

    def lookup(self, person: dict) -> dict:
        """Resolve contact info. Precise path: rr_id or linkedin_url. Otherwise SEARCH
        (name + employer) to get an id, then lookup by id — we never use the direct
        name+employer lookup (it 404s) and never guess. Returns normalized contact;
        status 'no_match' when RR has no profile for this person."""
        rid = person.get("rr_id")
        li = person.get("linkedin_url")
        if not rid and not li:
            rid = self._resolve_id(person)
            if not rid:
                return {"email": None, "phone": None, "status": "no_match", "source": "rocketreach"}

        params: dict = {}
        if rid:
            params["id"] = rid
        elif li:
            params["linkedin_url"] = li
        else:
            return {"email": None, "phone": None, "status": "no_input", "source": "rocketreach"}

        status_code, data = self._t("GET", f"{ROCKETREACH_BASE}/person/lookup", self._headers(), params=params)
        if status_code >= 400:
            return {"email": None, "phone": None, "status": "error", "source": "rocketreach"}

        result = self._normalize(data)
        # Poll while a needed field is missing and the lookup is still in progress.
        rr_id = result.get("rr_id")
        attempts = 0
        while ((not result.get("email")) or (not result.get("phone"))) and \
                result.get("status") in ("searching", "progress", "waiting") and rr_id and attempts < self.poll_attempts:
            time.sleep(self.poll_wait)
            attempts += 1
            sc, d = self._t("GET", f"{ROCKETREACH_BASE}/person/checkStatus", self._headers(), params={"ids": rr_id})
            rows = d if isinstance(d, list) else [d]
            for row in rows:
                if isinstance(row, dict) and (row.get("id") == rr_id or len(rows) == 1):
                    result = self._normalize(row)
        return result

    @staticmethod
    def _normalize(data: dict) -> dict:
        best = pick_best_email(data.get("emails") or [])
        return {
            "rr_id": data.get("id"),
            "status": data.get("status", "complete"),
            "email": best.get("email") if best else None,
            "email_status": best.get("smtp_valid") if best else None,
            "phone": pick_phone(data.get("phones") or []),
            "source": "rocketreach",
        }


# ─── Apollo (fallback) ───────────────────────────────────────────────────────

class ApolloClient:
    def __init__(self, api_key: str, transport: Optional[Transport] = None):
        self.api_key = api_key
        self._t = transport or _default_transport

    def _headers(self) -> dict:
        return {"X-Api-Key": self.api_key, "Content-Type": "application/json"}

    def match(self, person: dict, reveal_email: bool = True, reveal_phone: bool = True) -> dict:
        """People Match enrichment. Returns {email, phone}. Never raises."""
        body = {
            "first_name": person.get("first_name") or _first(person.get("name")),
            "last_name": person.get("last_name") or _last(person.get("name")),
            "organization_name": person.get("company"),
            "domain": person.get("domain"),
            "linkedin_url": person.get("linkedin_url"),
            "reveal_personal_emails": bool(reveal_email),
            "reveal_phone_number": bool(reveal_phone),
        }
        body = {k: v for k, v in body.items() if v not in (None, "")}
        status_code, data = self._t("POST", f"{APOLLO_BASE}/people/match", self._headers(), json_body=body)
        if status_code >= 400 or not isinstance(data, dict):
            return {"email": None, "phone": None, "source": "apollo", "status": "error"}

        p = data.get("person") if isinstance(data.get("person"), dict) else data
        email = p.get("email")
        if email in ("email_not_unlocked@domain.com", "", None):
            email = None
        return {
            "email": email,
            "phone": pick_phone(p.get("phone_numbers") or []),
            "source": "apollo",
            "status": "ok",
        }


def _first(name: Optional[str]) -> Optional[str]:
    return (name or "").strip().split(" ")[0] or None if name else None


def _last(name: Optional[str]) -> Optional[str]:
    parts = (name or "").strip().split(" ")
    return parts[-1] if len(parts) > 1 else None


# ─── the waterfall ───────────────────────────────────────────────────────────

def run_waterfall(person: dict, rr: RocketReachClient, apollo: Optional[ApolloClient]) -> dict:
    """
    RocketReach primary → Apollo fallback for whatever's still missing →
    delivery gate. Apollo is only called (a credit only spent) for the gaps RR
    left, never when RR already returned both.
    """
    sources: list = []
    rr_res = rr.lookup(person)
    email = rr_res.get("email")
    phone = rr_res.get("phone")
    if email:
        sources.append("rocketreach:email")
    if phone:
        sources.append("rocketreach:phone")

    if apollo is not None and (not email or not phone):
        ap = apollo.match(person, reveal_email=not email, reveal_phone=not phone)
        if not email and ap.get("email"):
            email = ap["email"]
            sources.append("apollo:email")
        if not phone and ap.get("phone"):
            phone = ap["phone"]
            sources.append("apollo:phone")

    return {
        "email": email,
        "phone": phone,
        "status": apply_delivery_gate(email, phone),
        "email_status": rr_res.get("email_status"),
        "rr_id": rr_res.get("rr_id"),
        "sources": sources,
    }
