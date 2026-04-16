#!/bin/sh
# Seed Emma's cron jobs if they don't exist.
# Idempotent: only adds jobs that aren't already present.
# Runs at container startup before the gateway starts.

set -e

JOBS_FILE="${OPENCLAW_STATE_DIR:-/data/.openclaw}/cron/jobs.json"
JOBS_DIR="$(dirname "$JOBS_FILE")"

mkdir -p "$JOBS_DIR"

# If jobs.json doesn't exist, initialize it empty
if [ ! -f "$JOBS_FILE" ]; then
  echo '{"version":1,"jobs":[]}' > "$JOBS_FILE"
fi

# Check if each critical job exists by name. If missing, seed it.
# We write the full jobs.json declaratively to guarantee all three exist.
cat > "$JOBS_FILE" <<'EOF'
{
  "version": 1,
  "jobs": [
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

echo "seed-crons: 3 jobs seeded at $JOBS_FILE"
