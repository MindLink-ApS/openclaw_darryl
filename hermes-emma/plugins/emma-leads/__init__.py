"""Emma Leads — native Hermes plugin.

Darryl's P&C executive-move lead engine, ported from the OpenClaw "Emma Jones"
agent. Native tools for discovery (people-moves RSS feeds), dedup (identity +
URL + watermark), enrichment (RocketReach→Apollo waterfall), and the leads DB.
Replaces the old OpenClaw leads/Apollo plugin.
"""

import logging
from pathlib import Path

from . import schemas, tools

logger = logging.getLogger(__name__)

_TOOLS = [
    ("discover_people_moves", schemas.DISCOVER_PEOPLE_MOVES, tools.discover_people_moves),
    ("dedup_check", schemas.DEDUP_CHECK, tools.dedup_check),
    ("lead_candidate_upsert", schemas.LEAD_CANDIDATE_UPSERT, tools.lead_candidate_upsert),
    ("lead_upsert", schemas.LEAD_UPSERT, tools.lead_upsert),
    ("leads_search", schemas.LEADS_SEARCH, tools.leads_search),
    ("lead_get", schemas.LEAD_GET, tools.lead_get),
    ("leads_stats", schemas.LEADS_STATS, tools.leads_stats),
    ("leads_export_csv", schemas.LEADS_EXPORT_CSV, tools.leads_export_csv),
    ("lead_update_pipeline", schemas.LEAD_UPDATE_PIPELINE, tools.lead_update_pipeline),
    ("lead_record_contact", schemas.LEAD_RECORD_CONTACT, tools.lead_record_contact),
    ("enrich_contact", schemas.ENRICH_CONTACT, tools.enrich_contact),
]


def register(ctx):
    """Register tools + bundle Emma's skills. Called once at startup."""
    for name, schema, handler in _TOOLS:
        ctx.register_tool(name=name, toolset="emma_leads", schema=schema, handler=handler)

    # Bundle the skills shipped in this plugin (loaded via skill_view("emma-leads:<name>")).
    skills_dir = Path(__file__).parent / "skills"
    if skills_dir.exists():
        for child in sorted(skills_dir.iterdir()):
            skill_md = child / "SKILL.md"
            if child.is_dir() and skill_md.exists():
                try:
                    ctx.register_skill(child.name, skill_md)
                except Exception as e:  # never fail plugin load on a skill
                    logger.warning("emma-leads: skill %s not registered: %s", child.name, e)

    logger.info("emma-leads: registered %d tools", len(_TOOLS))
