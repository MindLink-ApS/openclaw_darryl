# Heartbeat — Periodic Checks

## Every Cycle

1. **Inbox check** — Call `email_inbox_check` to list recent unread emails. For each unread email:
   - **Forwarded newsletter** (from Darryl, contains "Comings & Goings" or similar digest) → process with the `newsletter-parse` skill
   - **BCC'd outreach** (from Darryl, addressed to a lead) → record via `leads_record_contact`, advance status to `contacted`, store context in mem0
   - **External reply** (from someone outside Trusted Contacts) → follow the reply handling protocol in SOUL.md (acknowledge, notify Darryl, update lead)
   - **Other** (spam, automated, irrelevant) → ignore
     Track processed message subjects in mem0 to avoid re-processing on the next heartbeat cycle.
2. **Stale leads** — Find leads with status `new` that are older than 48 hours. Either promote to `queued_for_outreach` if validated, or flag as `needs_human_review`.
3. **Daily report status** — Verify today's daily report has been sent. If not and it's past 6:30 AM CT, generate and send it.
4. **Memory sync** — Use `mem0_recall` to check for recent feedback from Darryl that should influence current search patterns.
5. **Pending replies** — Already covered by the inbox check in step 1. Skip if step 1 ran successfully.

## Self-Health Checks (Every Cycle)

6. **Search API** — Run a trivial `web_search` query (e.g., `"property casualty" insurance 2026`). If it fails, include a note in the next report: "Web search was temporarily unavailable — today's results may be incomplete."
7. **Leads database** — Call `leads_stats`. If it errors, this is critical — email Darryl immediately with subject `Emma Jones — Database Issue` and the error details.
8. **Email delivery** — If the last `email_send` or `email_send_csv` failed, retry once. If retry also fails, log it. On the next successful send, mention: "Note: a previous email may not have been delivered due to a temporary issue."
9. **Memory system** — Call `mem0_recall` with a known query. If it errors, note that preferences and exclusions may not be applied in this cycle.

## Weekly (Monday)

10. **Pipeline cleanup** — Review all `contacted` leads older than 30 days with no follow-up activity. Email Darryl a list and suggest status updates (advance to `in_conversation`, mark `do_not_contact`, or schedule another follow-up).
11. **Source health** — Verify key data sources are still accessible by running `web_fetch` on each homepage:
    - insurancejournal.com
    - businessinsurance.com
    - carriermanagement.com
    - propertycasualty360.com
    - ambest.com
      Report any that are down, blocking access, or returning unexpected content.
12. **Weekly digest** — Generate a full pipeline summary and call plan for the week. Group leads by contact count for prioritization. Email to Darryl with CSV attachment.
13. **Overdue follow-ups** — Find leads where `next_follow_up` date has passed. Include prominently in the weekly digest under "Overdue Follow-ups."
14. **Expiring leads** — Find leads approaching the 60-day window edge. Flag any that will age out this week so Darryl can prioritize.

## Monthly (First Monday)

15. **Pipeline health report** — Summarize the full month: leads discovered, leads contacted, conversion to `in_conversation`, leads expired/removed. Include trends (improving/declining lead volume, best-performing sources).
16. **Source effectiveness** — Review which search queries and sources yielded the most validated leads. Store findings via `mem0_remember` to refine future searches.
17. **Preference review** — Recall all stored exclusions and preferences. Include a brief list in the monthly email so Darryl can confirm they're still accurate.

## Error Escalation

If any critical system is down (leads DB, email delivery, or all search sources simultaneously), send Darryl an immediate alert:

**Subject:** `Emma Jones — System Issue`

**Body:**

```
Hi Darryl,

I've detected an issue that may affect today's operations:

- Issue: [description]
- Impact: [what's affected — search / database / email]
- Action taken: [what was tried, what's the fallback]

I'll continue with available systems and notify you when resolved.

Best,
Emma Jones
Research Associate
```

| Scenario                      | Action                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Web search API down           | Skip search phase, note in report, retry next cycle                              |
| Leads database error          | Immediate alert to Darryl, halt writes until resolved                            |
| Email send failure            | Retry once. If still failing, log and alert on next successful send              |
| Gmail credentials expired     | Cannot recover automatically — alert and await manual fix                        |
| All sources paywalled/blocked | Note in report, try alternative queries, flag for Darryl                         |
| Memory system down            | Continue without preferences — note in report that exclusions may not be applied |
