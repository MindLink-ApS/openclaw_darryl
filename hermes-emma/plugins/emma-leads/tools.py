"""Tool handlers — the code that runs when the model calls each tool.

Handlers follow the Hermes contract: signature (args: dict, **kwargs) -> str,
always return a JSON string, never raise.
"""

import json
import os
import tempfile
import time

from . import enrichment
from . import discovery
from .db import get_db


def discover_people_moves(args: dict, **kwargs) -> str:
    """Pull only-new P&C exec moves from the curated RSS feeds."""
    try:
        out = discovery.poll_all(get_db())
        items = [
            {"title": i["title"], "link": i["link"], "published_at": i.get("published_at"),
             "source": i["source_label"], "summary": (i.get("summary") or "")[:300]}
            for i in out["new_items"]
        ]
        errors = [{"source": r["name"], "error": r["error"]} for r in out["results"] if r.get("error")]
        return json.dumps({"new_count": out["new_count"], "items": items, "feed_errors": errors})
    except Exception as e:
        return json.dumps({"error": f"discovery failed: {e}"})


def dedup_check(args: dict, **kwargs) -> str:
    try:
        people = args.get("people") or []
        return json.dumps(get_db().dedup_check(people))
    except Exception as e:
        return json.dumps({"error": str(e)})


def lead_candidate_upsert(args: dict, **kwargs) -> str:
    try:
        lead_id = get_db().candidate_upsert(args)
        return json.dumps({"id": lead_id, "status": "candidate"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def lead_upsert(args: dict, **kwargs) -> str:
    try:
        db = get_db()
        lead_id = db.upsert(args)
        row = db.get(lead_id)
        return json.dumps({"id": lead_id, "status_pipeline": row["status_pipeline"],
                           "deliverable": row["status_pipeline"] == "new"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def leads_search(args: dict, **kwargs) -> str:
    try:
        rows = get_db().search(args.get("status"), args.get("company"), int(args.get("limit", 200)))
        return json.dumps({"count": len(rows), "leads": rows})
    except Exception as e:
        return json.dumps({"error": str(e)})


def lead_get(args: dict, **kwargs) -> str:
    try:
        row = get_db().get(int(args["id"]))
        return json.dumps(row or {"error": "not found"})
    except Exception as e:
        return json.dumps({"error": str(e)})


def leads_stats(args: dict, **kwargs) -> str:
    try:
        return json.dumps(get_db().stats())
    except Exception as e:
        return json.dumps({"error": str(e)})


def leads_export_csv(args: dict, **kwargs) -> str:
    try:
        out_dir = os.path.join(tempfile.gettempdir(), "emma-reports")
        path = os.path.join(out_dir, f"leads-{time.strftime('%Y%m%d-%H%M%S')}.csv")
        return json.dumps(get_db().export_csv(path, args.get("status")))
    except Exception as e:
        return json.dumps({"error": str(e)})


def lead_update_pipeline(args: dict, **kwargs) -> str:
    try:
        ok = get_db().update_pipeline(int(args["id"]), args["status"], args.get("reason", ""))
        return json.dumps({"updated": ok})
    except Exception as e:
        return json.dumps({"error": str(e)})


def lead_record_contact(args: dict, **kwargs) -> str:
    try:
        ok = get_db().record_contact(int(args["id"]), int(args.get("follow_up_days", 7)))
        return json.dumps({"recorded": ok})
    except Exception as e:
        return json.dumps({"error": str(e)})


def enrich_contact(args: dict, **kwargs) -> str:
    """RocketReach→Apollo waterfall for a single person."""
    name = (args.get("name") or "").strip()
    company = (args.get("company") or "").strip()
    if not name or not company:
        return json.dumps({"error": "name and company are required"})

    rr_key = os.environ.get("ROCKETREACH_API_KEY")
    if not rr_key:
        return json.dumps({"error": "ROCKETREACH_API_KEY is not set"})

    person = {
        "name": name,
        "company": company,
        "linkedin_url": args.get("linkedin_url"),
        "domain": args.get("domain"),
        "rr_id": args.get("rr_id"),
    }

    try:
        rr = enrichment.RocketReachClient(rr_key)
        apollo_key = os.environ.get("APOLLO_API_KEY")
        apollo = enrichment.ApolloClient(apollo_key) if apollo_key else None

        result = enrichment.run_waterfall(person, rr, apollo)
        result["name"] = name
        result["company"] = company
        result["deliverable"] = result["status"] == "new"
        if apollo is None and result["status"] != "new":
            result["note"] = "APOLLO_API_KEY not set — fallback unavailable; RocketReach only."
        return json.dumps(result)
    except Exception as e:  # never raise out of a tool
        return json.dumps({"error": f"enrichment failed: {e}", "name": name, "company": company})
