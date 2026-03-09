---
name: daily-scout
description: Run the daily P&C insurance executive move discovery. Searches trade journals, company newsrooms, and LinkedIn for executive job changes in the last 60 days, validates and stores leads, then emails a CSV report to Darryl.
metadata:
  openclaw:
    emoji: "🔍"
    always: true
---

# Daily Discovery — P&C Executive Move Discovery

Run this skill when triggered by the daily cron job or when Darryl asks you to search for new leads.

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

## Step 3: Resolve Pending Leads (BEFORE new discovery)

Before enriching new leads, check all leads stuck in `awaiting_phone` status:

1. Call `leads_search` with `status: "awaiting_phone"` to find pending leads
2. Call `apollo_usage` to check budget status AND expire pending records older than 2 hours
3. For each `awaiting_phone` lead:
   - If the webhook already delivered the phone (lead now has `mobile_phone` populated and status was promoted to `"new"` by the webhook handler) → it was already sent to Darryl individually. Note as "(sent earlier today)" for the daily report recap.
   - If still awaiting AND pending < 2 hours → leave alone, webhook may still arrive
   - If pending >= 2 hours or expired → web search fallback for phone:
     ```
     web_search: "<full name>" "<company>" phone OR "direct line" OR "contact"
     web_search: "<company>" "leadership" OR "directory" phone
     ```

     - Phone found via web? → `leads_upsert` with phone + status `"new"`, deliver in today's report
     - Still no phone? → `leads_update_pipeline` to `"needs_human_review"`, never deliver

## Step 4: Enrich Each New Lead via Apollo

For each validated lead from Step 2:

1. Search for their LinkedIn profile: `web_search` for `"<full name>" "<company>" site:linkedin.com`
2. Search for company HQ: `web_search` for `"<company>" headquarters address`
3. Look for geography info in the article or company page
4. Determine functional focus from title/context (distribution, underwriting, claims, etc.)

### Apollo Enrichment (replaces manual email/phone search)

5. Call `apollo_enrich` (or batch up to 10 leads with `apollo_bulk_enrich`) with `first_name`, `last_name`, `organization_name`, `domain` (if known), `linkedin_url` (if known)
6. Based on the result:
   - **`deliver: true` (complete — both email + phone found):**
     Call `leads_upsert` with all fields including `email_address`, `mobile_phone`, `status_pipeline: "new"`. Add to today's report.
   - **`status: "awaiting_phone"` (email found, async phone hunt triggered):**
     Call `leads_upsert` with email, `status_pipeline: "awaiting_phone"`. DO NOT include in today's report. The phone will arrive via webhook within ~15 minutes and Darryl will be notified automatically.
   - **`status: "no_email"` or `"no_match"` (Apollo couldn't find them):**
     Fall back to manual web search for email and phone (existing queries from lead-enrich skill). If BOTH found → `leads_upsert` status `"new"`, deliver. If not both → `leads_upsert` status `"needs_human_review"`.
   - **`status: "budget_exhausted"`:**
     Fall back to manual web search for both email and phone. Note budget status internally.

7. **Validate any contact details** — whether from Apollo or web search:
   - Confirm email domain matches company domain
   - Never adopt generic addresses (info@, contact@, hr@)
   - Never guess patterns — only use explicitly published or Apollo-verified values
   - Record source URLs for web-sourced contacts

## Step 5: Store Leads

For each enriched lead, call `leads_upsert` with all available fields. Set `status_pipeline` based on Apollo result:

- `"new"` if both email AND phone are confirmed
- `"awaiting_phone"` if email found but phone pending (async Apollo or web search fallback)
- `"needs_human_review"` if neither contact method found

**Never fabricate** email addresses or phone numbers. Always record the source URL where a contact detail was found.

## Step 6: Generate Report

1. Call `leads_export_csv` filtered to leads with BOTH email AND phone populated (status `"new"` or `"queued_for_outreach"` with today's date range)
2. Call `leads_stats` to get summary counts
3. Call `email_send_csv` to send the report:

**To:** darryl.thompson@raymondjames.com
**Subject:** `Emma Jones Daily Report — YYYY-MM-DD — N New Leads`
**Body:**

```
Daily P&C Executive Move Report

Summary:
- Sources checked: [N] trade journals, [N] company newsrooms, [N] LinkedIn searches
- New complete leads today: [N] (all with verified email + phone)
[If some were sent individually via webhook earlier:]
- (N of these were sent to you earlier today as they became ready)

Top New Leads:
1. [Name] — [Title] @ [Company] ([Geography])
2. [Name] — [Title] @ [Company] ([Geography])
...

Pipeline Status:
- New: [N]
- Queued for outreach: [N]
- Contacted: [N]
- In conversation: [N]

The attached CSV contains all complete leads (email + phone confirmed).

Next scheduled run: [tomorrow at 6 AM CT]
```

**CSV attachment:** Use the path from `leads_export_csv` — ONLY leads with both email and phone.

## Step 7: Remember

Use `mem0_remember` to store:

- Number of leads found today
- Any new data sources discovered
- Any patterns noticed (e.g., "Insurance Journal published a large batch of moves this week")

## Error Handling

- If a web search fails, log it and continue with other searches
- If a source is behind a paywall, skip it — do not attempt to bypass
- If uncertain about P&C relevance, set `status_pipeline` to `needs_human_review`
- If the email send fails, log the error and retry once
