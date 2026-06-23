# Emma Jones — Hermes Deployment (GCP)

Hermes-native port of the OpenClaw "Emma Jones" P&C executive-move tracker for Darryl.
Discovery + dedup + RocketReach→Apollo enrichment now live as a native Hermes plugin.

## What's in this folder
```
hermes-emma/
├── plugins/emma-leads/      Native Hermes plugin (the engine)
│   ├── plugin.yaml          Manifest (requires ROCKETREACH_API_KEY; optional APOLLO_API_KEY)
│   ├── __init__.py          register(ctx) → 11 tools + bundles the skill
│   ├── schemas.py           Tool schemas the model reads
│   ├── tools.py             Tool handlers
│   ├── discovery.py         RSS people-moves ingestion (watermark = only-new-since-last-run)
│   ├── db.py                SQLite leads DB + dedup ledger (identity / seen_urls / watermark)
│   ├── enrichment.py        RocketReach → Apollo waterfall (email+phone delivery gate)
│   └── test_*.py            23 offline unit tests (python3 -m unittest)
├── skills/daily-scout/      Daily discovery workflow (dedup-before-spend, RSS-first)
├── SOUL.md                  Emma persona
├── AGENTS.md                Mission / ICP / rules / native tool names
└── DEPLOYMENT.md            This file
```

## Native tools (replace the old OpenClaw leads/Apollo plugin)
`discover_people_moves` · `dedup_check` · `lead_candidate_upsert` · `lead_upsert` ·
`leads_search` · `lead_get` · `leads_stats` · `leads_export_csv` ·
`lead_update_pipeline` · `lead_record_contact` · `enrich_contact`

`mem0_*` → Hermes native `memory()`. `web_search`/`web_fetch`/`browser`/`email`/`cron` → Hermes built-ins.

## The search fix (Darryl's redundancy complaint)
Old approach = relevance-ranked keyword search over a rolling 60-day window → re-surfaces
the same people for weeks. New approach = **dedicated P&C "people-moves" RSS feeds, ingested
newest-first with a per-feed date watermark** → only what published since the last run.
Plus dedup BEFORE spending: `discover → dedup_check → qualify (gate) → enrich → store`.
Feeds: Carrier Management (purest), Insurance Journal, Risk & Insurance, Reinsurance News,
Insurance Business America, PC360.

## Live deployment
| Item | Value |
|---|---|
| GCP project | `marketing-465120` |
| VM | `daryl-tate-agent`, zone `us-east1-b`, ext IP `34.26.70.168` |
| Spec | e2-medium (2 vCPU / 3.8 GB / 30 GB), Ubuntu 24.04, always-on |
| Hermes | v0.17.0 at `~/.local/bin/hermes`, config `~/.hermes/` |
| Plugin | `~/.hermes/plugins/emma-leads/` (enabled) |
| Skill / persona / mission | `~/.hermes/skills/daily-scout/`, `~/.hermes/SOUL.md`, `~/.hermes/emma-workdir/AGENTS.md` |
| Model | OpenRouter (provider auto), default `anthropic/claude-opus-4.6` |
| Web search | RSS-first; keyless DuckDuckGo (`ddgs`) for the supplement |
| Schedule | system crontab `0 4 * * 1-5` (4am CT weekdays) → `~/.hermes/run-daily-scout.sh` |
| Timezone | America/Chicago |

## Keys (`~/.hermes/.env`, chmod 600)
- `OPENROUTER_API_KEY` — model ✅ set
- `ROCKETREACH_API_KEY` — primary enrichment ✅ set
- `APOLLO_API_KEY` — fallback enrichment (optional, not yet set)
- `EMAIL_*` — mailbox for delivery to Darryl (not yet set — see below)

## Verified working (2026-06-22)
- 23 engine unit tests pass on the VM.
- Live discovery: pulled real P&C moves (GEICO CFO, Kemper CEO, Hippo COO, Willis Re…).
- Live scoped pipeline (3 leads, real RocketReach): 2/3 returned email+phone → status `new`;
  1 held `needs_human_review`; Apollo fallback correctly reported unavailable.

## Remaining for full autonomy
1. **Email mailbox** — add `EMAIL_ADDRESS/PASSWORD/IMAP_HOST/SMTP_HOST/ALLOWED_USERS/HOME_ADDRESS`
   to `~/.hermes/.env`, then the daily run delivers the CSV to Darryl + inbound handling works.
2. `APOLLO_API_KEY` — raises email+phone fill rate via the fallback.
3. Port the remaining 5 skills (newsletter-parse, lead-enrich, lead-report, contact-backfill,
   feedback) — they reuse these same 11 tools.

## Redeploy / operate
```bash
gcloud compute ssh daryl-tate-agent --zone=us-east1-b
hermes plugins list                 # confirm emma-leads enabled
hermes chat -q "run discover_people_moves and report new_count"   # smoke test
crontab -l                          # the daily schedule
tail -f ~/.hermes/logs/cron-daily-scout.log
```
