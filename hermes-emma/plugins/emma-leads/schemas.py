"""Tool schemas — what the model reads to decide when to call each tool."""

ENRICH_CONTACT = {
    "name": "enrich_contact",
    "description": (
        "Find a person's verified work email AND phone number using the "
        "RocketReach→Apollo enrichment waterfall. Use this AFTER a lead has been "
        "discovered and passed the qualification gate, to get contact details. "
        "RocketReach is tried first; Apollo fills whatever is missing. "
        "Returns status 'new' only when BOTH email and phone are found "
        "(Darryl's delivery bar); 'awaiting_phone' if only email; "
        "'needs_human_review' if neither. Never invents data."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "Full name, e.g. 'Jane Smith'"},
            "company": {"type": "string", "description": "Current (new) employer name"},
            "linkedin_url": {"type": "string", "description": "LinkedIn profile URL, if known (improves match)"},
            "domain": {"type": "string", "description": "Company email domain, if known (e.g. 'acme.com')"},
            "rr_id": {"type": "integer", "description": "RocketReach profile id, if already known (cheapest lookup)"},
        },
        "required": ["name", "company"],
    },
}

DISCOVER_PEOPLE_MOVES = {
    "name": "discover_people_moves",
    "description": (
        "Pull NEW P&C insurance executive job-change announcements from the "
        "curated trade-journal 'people on the move' RSS feeds (Carrier "
        "Management, Insurance Journal, Risk & Insurance, etc.). Returns ONLY "
        "items published since the last run (per-feed date watermark) — so you "
        "never re-process the same announcements. This is the PRIMARY discovery "
        "step: run it first, then filter to US + target titles, dedup, qualify, "
        "and enrich. Returns each item's title, link, published date, and source."
    ),
    "parameters": {"type": "object", "properties": {}},
}

DEDUP_CHECK = {
    "name": "dedup_check",
    "description": (
        "Given a list of discovered people, return which are NEW vs already in "
        "the database. Call this BEFORE spending scrape/enrichment budget so you "
        "only process genuinely new movers. Matches on name+company identity, "
        "LinkedIn URL, and email."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "people": {
                "type": "array",
                "description": "People to check",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "company": {"type": "string"},
                        "linkedin_url": {"type": "string"},
                        "email": {"type": "string"},
                    },
                    "required": ["name", "company"],
                },
            }
        },
        "required": ["people"],
    },
}

_LEAD_FIELDS = {
    "full_name": {"type": "string"},
    "current_title": {"type": "string"},
    "current_company": {"type": "string"},
    "company_domain": {"type": "string"},
    "company_hq_address": {"type": "string"},
    "linkedin_url": {"type": "string"},
    "email_address": {"type": "string"},
    "mobile_phone": {"type": "string"},
    "geography": {"type": "string"},
    "functional_focus": {"type": "string"},
    "move_type": {"type": "string"},
    "move_effective_date": {"type": "string"},
    "source_type": {"type": "string", "description": "web | newsletter"},
    "source_label": {"type": "string"},
    "source_url": {"type": "string"},
    "source_published_date": {"type": "string"},
    "notes": {"type": "string"},
}

LEAD_CANDIDATE_UPSERT = {
    "name": "lead_candidate_upsert",
    "description": (
        "Store a PRE-enrichment candidate (the qualification-gate stage), with a "
        "qualification_score (0-100) and source info. Always call this before "
        "enrich_contact — never enrich below the gate (>=70 web, >=60 newsletter). "
        "Auto-dedupes on identity."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            **_LEAD_FIELDS,
            "qualification_score": {"type": "integer", "description": "0-100"},
            "qualification_status": {"type": "string", "description": "qualified | candidate | rejected"},
        },
        "required": ["full_name", "current_company"],
    },
}

LEAD_UPSERT = {
    "name": "lead_upsert",
    "description": (
        "Insert or update a validated lead with all known fields (email/phone, "
        "geography, source, etc.). Status auto-derives from completeness: 'new' "
        "when BOTH email AND phone present, else 'awaiting_phone' / 'candidate'. "
        "Auto-dedupes on identity. Never fabricate contact data."
    ),
    "parameters": {"type": "object", "properties": {**_LEAD_FIELDS,
                   "status_pipeline": {"type": "string"}}, "required": ["full_name", "current_company"]},
}

LEADS_SEARCH = {
    "name": "leads_search",
    "description": "Find leads by pipeline status and/or company. Use to resolve awaiting_phone leads, build reports, or look up by company for email-pattern inference.",
    "parameters": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "e.g. awaiting_phone, new, needs_human_review"},
            "company": {"type": "string"},
            "limit": {"type": "integer"},
        },
    },
}

LEAD_GET = {
    "name": "lead_get",
    "description": "Retrieve a single lead's full record (all fields + sources) by id.",
    "parameters": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]},
}

LEADS_STATS = {
    "name": "leads_stats",
    "description": "Pipeline counts by status (total, new, awaiting_phone, candidate, etc.). Use for the daily Capacity Snapshot and onboarding empty-check.",
    "parameters": {"type": "object", "properties": {}},
}

LEADS_EXPORT_CSV = {
    "name": "leads_export_csv",
    "description": (
        "Write a CSV of delivery-ready leads to a file and return its path. "
        "ONLY includes leads with BOTH email AND phone (Darryl's delivery gate) — "
        "partial leads are never exported. Attach the returned file to the email."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "status": {"type": "string", "description": "Optional pipeline-status filter (e.g. 'new')"},
        },
    },
}

LEAD_UPDATE_PIPELINE = {
    "name": "lead_update_pipeline",
    "description": "Change a lead's pipeline status (e.g. to do_not_contact, queued_for_outreach, needs_human_review). do_not_contact requires a reason.",
    "parameters": {
        "type": "object",
        "properties": {
            "id": {"type": "integer"},
            "status": {"type": "string"},
            "reason": {"type": "string"},
        },
        "required": ["id", "status"],
    },
}

LEAD_RECORD_CONTACT = {
    "name": "lead_record_contact",
    "description": "Record that Darryl contacted a lead (BCC/forward). Increments contact_count, sets last_contacted_at and next_follow_up.",
    "parameters": {
        "type": "object",
        "properties": {"id": {"type": "integer"}, "follow_up_days": {"type": "integer"}},
        "required": ["id"],
    },
}
