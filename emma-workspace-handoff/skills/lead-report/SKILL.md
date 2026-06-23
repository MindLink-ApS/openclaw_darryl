---
name: lead-report
description: Generate and email a lead report to Darryl. Supports daily reports, weekly digests, filtered exports, and pipeline summaries. Use when Darryl asks for a report, export, or CSV of his leads.
metadata:
  openclaw:
    emoji: "📊"
    always: true
---

# Lead Report — Generate & Email Reports

Run this skill when Darryl asks for a report, export, or summary of his leads, or when triggered by the weekly cron job.

## Report Types

### Daily Report

Triggered by: daily cron or "send me today's report"

1. Call `leads_stats` for summary counts
2. Call `leads_search` with `date_from` = today for new leads
3. Call `apollo_usage` for the monthly credit and pending-phone snapshot
4. Call `leads_export_csv` for full CSV
5. Email via `email_send_csv`

### Weekly Digest (Monday Call Plan)

Triggered by: weekly cron (Monday) or "send me the weekly summary"

1. Call `leads_stats` for overall pipeline health
2. Call `leads_search` with `date_from` = 7 days ago for weekly additions
3. Call `leads_search` with `status` = `needs_human_review` for items needing attention
4. Call `leads_search` with `status` = `queued_for_outreach` for call-ready leads
5. Call `leads_search` with `status` = `contacted` for follow-ups
6. Call `apollo_usage` for the monthly credit and pending-phone snapshot
7. Group leads by contact_count for the call plan:
   - **First contact (contact_count = 0):** New leads ready for outreach
   - **Second contact (contact_count = 1):** Follow up from first outreach
   - **Third+ contact (contact_count >= 2):** Persistent follow-ups
   - **Overdue follow-ups:** Leads where next_follow_up < today
8. Compose a digest:

```
Weekly Call Plan — Week of [date]

CALLS TO MAKE THIS WEEK:

First Contact (New Outreach):
1. [Name] — [Title] @ [Company] ([Geography]) — [LinkedIn]
2. ...

Second Contact (Follow-up #1):
1. [Name] — [Title] @ [Company] — Last contacted: [date]
2. ...

Third+ Contact (Persistent Follow-up):
1. [Name] — [Title] @ [Company] — Contacted [N] times, last: [date]
2. ...

Overdue Follow-ups:
1. [Name] — Was due [date] — [Title] @ [Company]
2. ...

Pipeline Snapshot:
- New: [N]
- Queued for outreach: [N]
- Contacted: [N]
- In conversation: [N]
- Do not contact: [N]
- Needs review: [N]

This Week's Activity:
- New leads added: [N]
- Leads needing review: [N]

Action Items:
- [N] leads in "new" status for 48+ hours — consider promoting or reviewing
- [N] leads marked "needs_human_review" — your input needed

Capacity Snapshot:
- Apollo enrichments left this month: [remaining]/[limit]
- Phone lookups left this month: [remaining]/[limit]
- Pending phone lookups: [currently_awaiting]
- Research connectors: web search/fetch/browser available unless noted

Attached: Full lead database export (CSV)
```

9. Call `leads_export_csv` and send via `email_send_csv`

### Filtered Export

Triggered by: "export leads with status X" or "send me all new leads"

1. Parse the filter from Darryl's request (status, company, date range, etc.)
2. Call `leads_export_csv` with appropriate filters
3. Email via `email_send_csv` with a brief description of the filter applied

### Pipeline Status

Triggered by: "how many leads do I have?" or "pipeline status"

1. Call `leads_stats`
2. Reply via `email_send` with formatted summary (no CSV needed)

## Email Formatting Rules

- Keep emails scannable — use bullet points and short sections
- Lead with the most actionable info (new leads, items needing review)
- Include source citations where helpful
- Include a short Capacity Snapshot in daily and weekly emails so Darryl understands remaining credits and pending phone lookups
- Always mention the CSV attachment when one is included
- Use professional, concise tone (financial services context)
