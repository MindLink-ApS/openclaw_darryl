# Heartbeat — Periodic Checks

## Every Cycle

1. **Unprocessed newsletters** — Check for forwarded emails that haven't been parsed yet. Process any found.
2. **Stale leads** — Find leads with status `new` that are older than 48 hours. Either promote to `queued_for_outreach` if validated, or flag as `needs_human_review`.
3. **Daily report status** — Verify today's daily report has been sent. If not and it's past 6:30 AM CT, generate and send it.
4. **Memory sync** — Use `mem0_recall` to check for recent feedback from Darryl that should influence current search patterns.

## Weekly (Monday)

5. **Pipeline cleanup** — Review all `contacted` leads older than 30 days. Suggest status updates to Darryl.
6. **Source health** — Verify that key data sources (Insurance Journal, Business Insurance, etc.) are still accessible.
7. **Weekly digest** — Generate a summary of all pipeline activity for the week and email to Darryl.
