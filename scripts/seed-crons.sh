#!/bin/sh
# Seed Emma's cron jobs at container startup.
# - 3 recurring jobs (daily-scout, weekly-digest, monthly-report)
# - 1 one-shot "immediate run" that fires 60 seconds after startup,
#   runs daily-scout, emails Darryl, then self-deletes.

set -e

JOBS_FILE="${OPENCLAW_STATE_DIR:-/data/.openclaw}/cron/jobs.json"
JOBS_DIR="$(dirname "$JOBS_FILE")"

mkdir -p "$JOBS_DIR"

# Compute "now + 60s" in ISO 8601 UTC
IMMEDIATE_AT="$(date -u -d '+60 seconds' +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v+60S +'%Y-%m-%dT%H:%M:%SZ')"

cat > "$JOBS_FILE" <<EOF
{
  "version": 1,
  "jobs": [
    {
      "id": "kickstart-run",
      "name": "kickstart-run",
      "enabled": true,
      "schedule": {
        "kind": "at",
        "at": "${IMMEDIATE_AT}"
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "STARTUP TRIGGER. Run the daily-scout skill immediately to catch Darryl up after the outage. Search all sources for new P&C executive moves (US-only, 60-day window), validate, enrich via Apollo, store leads, and email 'Daily Scout Complete — [DATE] — [N] New Leads' to Darryl. This is a manual kick-start — do a full discovery pass even if not the usual 4 AM window. Include a brief one-line note at the top of the email: 'Back online — catching up on leads from the past 2 weeks.'"
      },
      "delivery": {
        "mode": "none"
      },
      "deleteAfterRun": true
    },
    {
      "id": "daily-scout",
      "name": "daily-scout",
      "enabled": true,
      "schedule": {
        "kind": "cron",
        "expr": "0 4 * * *",
        "tz": "America/Chicago"
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Run the daily-scout skill. Space Brave Search queries 5 minutes apart over a 2-hour window. Search all sources for new P&C executive moves (US-only), validate, enrich, store leads, and email the 'Daily Scout Complete' report to Darryl at 6 AM CT."
      },
      "delivery": {
        "mode": "none"
      }
    },
    {
      "id": "weekly-digest",
      "name": "weekly-digest",
      "enabled": true,
      "schedule": {
        "kind": "cron",
        "expr": "0 9 * * 1",
        "tz": "America/Chicago"
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Run the lead-report skill in weekly digest mode. Generate the Monday call plan grouped by contact count, include overdue follow-ups and expiring leads, and email to Darryl with CSV."
      },
      "delivery": {
        "mode": "none"
      }
    },
    {
      "id": "monthly-report",
      "name": "monthly-report",
      "enabled": true,
      "schedule": {
        "kind": "cron",
        "expr": "30 9 1-7 * 1",
        "tz": "America/Chicago"
      },
      "sessionTarget": "isolated",
      "wakeMode": "now",
      "payload": {
        "kind": "agentTurn",
        "message": "Generate the monthly pipeline health report: leads discovered vs contacted, conversion rates, source effectiveness, and preference review. Email to Darryl."
      },
      "delivery": {
        "mode": "none"
      }
    }
  ]
}
EOF

echo "seed-crons: 4 jobs seeded at $JOBS_FILE"
echo "seed-crons: kick-start will fire at ${IMMEDIATE_AT} (UTC)"
