---
name: daily-scout
description: Daily P&C executive-move discovery. Pulls new moves from people-on-the-move RSS feeds (and date-bounded web search), dedups BEFORE spending, qualifies, enriches via RocketReach→Apollo, stores leads, and emails Darryl a CSV of complete leads.
metadata:
  hermes:
    tags: [insurance, leads, discovery, p&c, daily]
    requires_tools: [discover_people_moves, dedup_check, enrich_contact]
---

# Daily Scout — P&C Executive Move Discovery

Run on the daily cron (4 AM CT) or when Darryl asks to search. The golden rule:
**dedup before you spend.** Never re-fetch, re-qualify, or re-enrich someone already
in the database — that is what was producing redundant lists.

## Step 0 — Recall preferences
`memory` recall for Darryl's `EXCLUSION` / `GOOD PATTERN` / `SOURCE QUALITY` notes. Apply
exclusions as filters; prioritize good sources.

## Step 1 — Resolve pending FIRST
Before discovering new leads, clear the backlog:
- `leads_search` status=`awaiting_phone`. For each: if a phone has since been found, complete
  it (`lead_upsert` → becomes `new`); if older than ~2h with no phone, run a `web_search`
  phone fallback; if still none, `lead_update_pipeline` → `needs_human_review`.

## Step 2 — DISCOVER (RSS-first, only what's new)
1. Call **`discover_people_moves`**. It returns ONLY items published since the last run
   (per-feed watermark) from Carrier Management, Insurance Journal, Risk & Insurance, etc.
   No keyword budget, no redundancy.
2. If you need more coverage, run a FEW `web_search` queries **bounded to the last several
   days** (e.g. add `after:YYYY-MM-DD`), not broad relevance queries over the whole 60-day
   window. Read promising results with `web_fetch` (or `browser` if blocked).

## Step 3 — DEDUP before spending
Collect the discovered people `[{name, company, linkedin_url?}]` and call **`dedup_check`**.
**Process only the `new` list.** (Article/profile URLs already seen are skipped automatically.)

## Step 4 — FILTER + VALIDATE (new people only)
P&C (not life/health-only)? target title (relaxed for newsletters)? within 60 days? US-only?
Cross-check ≥2 sources where possible; normalize company names. Drop or flag the rest.

## Step 5 — QUALIFY (the gate)
`lead_candidate_upsert` with `qualification_score` (0-100), `source_type`, `source_label`,
`source_url`, `qualification_status`. Continue to enrichment ONLY at score **≥70** (web) /
**≥60** (newsletter). Below → leave stored, do not enrich.

## Step 6 — ENRICH
For each gated-pass new lead, call **`enrich_contact`** (RocketReach primary → Apollo fallback).
- status `new` (both email+phone) → `lead_upsert` with all fields, include in today's report.
- status `awaiting_phone` (email only) → `lead_upsert`; held, do NOT deliver.
- status `needs_human_review` (neither) → `web_search` fallback for email+phone; deliver only
  if BOTH found, else `lead_update_pipeline` → `needs_human_review`.

## Step 7 — REPORT
1. `leads_export_csv` (only complete leads — both email + phone).
2. `leads_stats` for counts.
3. Email Darryl via `email` (attach the CSV). Subject: `Daily Scout Complete — [DATE] — [N] New Leads`.
   Body: count, top new leads (name — title @ company), any needs-review, and a Capacity
   Snapshot (pending phone count). No search-activity logs. Each lead appears once.

## Step 8 — Remember
`memory` store: leads found today, new sources discovered, notable patterns.
