---
name: daily-scout
description: Run the daily P&C insurance executive move scout. Searches trade journals, company newsrooms, and LinkedIn for executive job changes in the last 60 days, validates and stores leads, then emails a CSV report to Darryl.
metadata:
  openclaw:
    emoji: "🔍"
    always: true
---

# Daily Scout — P&C Executive Move Discovery

Run this skill when triggered by the daily cron job or when Darryl asks you to scout for new leads.

## Step 0: Recall Preferences & Exclusions

Before searching, load Darryl's feedback and preferences:

1. Call `mem0_recall` with query `"EXCLUSION lead preferences feedback"` to retrieve stored exclusions
2. Call `mem0_recall` with query `"GOOD PATTERN source quality"` to retrieve positive patterns and source ratings
3. Apply all `EXCLUSION:` results as filters during Step 2 processing (e.g., skip certain titles, companies, or insurance lines Darryl has rejected)
4. Prioritize sources and patterns flagged as `GOOD PATTERN:` or high-quality `SOURCE QUALITY:`

## Step 1: Search Sources

Run these web searches in sequence. For each, use the `web_search` tool:

### Trade journals (highest yield)
```
"property casualty" OR "P&C" "joined" OR "appointed" OR "promoted" site:insurancejournal.com
"property casualty" insurance "new role" OR "hired" OR "joins" site:businessinsurance.com
"property casualty" "vice president" OR "AVP" OR "director" "appointed" site:carriermanagement.com
P&C insurance executive "new position" OR "new role" site:propertycasualty360.com
"property casualty" insurance "people moves" OR "comings and goings" site:ambest.com
```

### Company newsrooms
```
insurance "chief development officer" OR "head of development" appointed OR hired 2026
P&C "regional director" OR "assistant vice president" new role OR joined 2026
insurance "underwriting leader" OR "senior underwriter" promoted OR appointed 2026
```

### LinkedIn public content
```
site:linkedin.com/posts "excited to announce" insurance "property casualty" 2026
site:linkedin.com/posts "thrilled to join" P&C insurance 2026
site:linkedin.com/in "property casualty" OR "P&C" "joined" OR "new role" 2026
```

### Press releases & SEC filings
```
"property casualty" insurance "press release" "appointed" OR "named" OR "promoted" 2026
insurance executive appointment site:sec.gov "Form 8-K" 2026
P&C insurance "names" OR "appoints" "chief" OR "vice president" site:prnewswire.com 2026
P&C insurance "names" OR "appoints" "chief" OR "vice president" site:businesswire.com 2026
```

### Local business journals
```
insurance executive "joins" OR "appointed" OR "promoted" site:bizjournals.com 2026
```

## Step 2: Process Each Result

For every search result that looks relevant:

1. Use `web_fetch` to read the full article/page
2. Extract: full name, new title, new company, effective date, source URL
3. **Filter check:**
   - Is this P&C insurance? (not life/health-only) → skip if no
   - Is the title one of our targets? (CDO, VP, Regional Director, AVP, BD, Underwriter) → skip if no
   - Is the move within 60 days? → skip if no
4. If passes all filters, continue to enrichment

## Step 3: Enrich Each Lead

For each validated lead:

1. Search for their LinkedIn profile: `web_search` for `"<full name>" "<company>" site:linkedin.com`
2. Search for company HQ: `web_search` for `"<company>" headquarters address`
3. Look for geography info in the article or company page
4. Determine functional focus from title/context (distribution, underwriting, claims, etc.)

## Step 4: Store Leads

For each enriched lead, call `leads_upsert` with all available fields:

```json
{
  "full_name": "Jane Smith",
  "current_title": "Vice President, Business Development",
  "current_company": "Chubb",
  "linkedin_url": "https://linkedin.com/in/janesmith",
  "source_published_date": "2026-02-15",
  "move_type": "new_employer",
  "geography": "New York, NY",
  "functional_focus": "business development",
  "status_pipeline": "new",
  "sources": [
    {
      "source_url": "https://insurancejournal.com/...",
      "source_label": "Insurance Journal",
      "published_on": "2026-02-15"
    }
  ]
}
```

**Never fabricate** email addresses or phone numbers. Leave those fields empty unless found in a public, lawful source.

## Step 5: Generate Report

1. Call `leads_export_csv` with today's date range to get the CSV file path
2. Call `leads_stats` to get summary counts
3. Call `email_send_csv` to send the report:

**To:** darryl.thompson@raymondjames.com
**Subject:** `Scout Daily Report — YYYY-MM-DD — N New Leads`
**Body:**
```
Daily P&C Executive Scout Report

Summary:
- Sources checked: [N] trade journals, [N] company newsrooms, [N] LinkedIn searches
- New leads found: [N]
- Updated existing leads: [N]
- Leads needing review: [N]

Top New Leads:
1. [Name] — [Title] @ [Company] ([Geography])
2. [Name] — [Title] @ [Company] ([Geography])
...

Pipeline Status:
- New: [N]
- Queued for outreach: [N]
- Contacted: [N]
- In conversation: [N]

The attached CSV contains all leads matching today's discovery.

Next scheduled run: [tomorrow at 6 AM CT]
```
**CSV attachment:** Use the path from `leads_export_csv`

## Step 6: Remember

Use `mem0_remember` to store:
- Number of leads found today
- Any new data sources discovered
- Any patterns noticed (e.g., "Insurance Journal published a large batch of moves this week")

## Error Handling

- If a web search fails, log it and continue with other searches
- If a source is behind a paywall, skip it — do not attempt to bypass
- If uncertain about P&C relevance, set `status_pipeline` to `needs_human_review`
- If the email send fails, log the error and retry once
