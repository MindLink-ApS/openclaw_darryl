---
name: newsletter-parse
description: Parse a forwarded "Comings & Goings" or "People Moves" newsletter digest. Extracts executive names, titles, and companies, then validates, enriches, and stores each as a lead.
metadata:
  openclaw:
    emoji: "📰"
    always: true
---

# Newsletter Parse — Forwarded Digest Processing

Run this skill when Darryl forwards an email containing a newsletter digest (e.g., Business Insurance "Comings & Goings", Insurance Journal "People Moves", or similar).

## Step 1: Extract People Mentioned

Parse the email body to identify every person mentioned along with:

- **Full name**
- **New title** (if mentioned)
- **New company** (if mentioned)
- **Previous company/role** (if mentioned, store in notes)
- **Any dates** mentioned

Common patterns to look for:

- "[Name] has joined [Company] as [Title]"
- "[Name] was named [Title] at [Company]"
- "[Name] has been appointed [Title] of [Company]"
- "[Name] → [Company]" (shorthand format)
- "[Company] has hired [Name] as [Title]"
- Bullet lists of name + company pairs

## Step 2: Filter for P&C Relevance

For each person extracted:

1. Is the company a P&C insurer, broker, or reinsurer? If unclear, search: `web_search` for `"<company>" "property casualty" OR "P&C" insurance`
2. Do **not** require the normal daily-scout target titles for forwarded newsletters. Darryl explicitly asked to broaden "Comings & Goings" style lists to everyone in the U.S. on those lists, no matter the title.
3. Is the person based in the United States? Check their geography, company office location, or role description. Anyone based outside the US (including US companies' international offices like London, Bermuda, Singapore) should be excluded. If geography is ambiguous from the newsletter text alone, flag for verification during enrichment (Step 3).
4. If the newsletter/source link is hard to read with `web_fetch`, use `browser` with `profile: "openclaw"` and an efficient AI snapshot. Firecrawl is not available.
5. Store each possible U.S. P&C candidate with `lead_candidates_upsert`, `source_type: "newsletter"`, and a `qualification_score`.
6. Continue to Apollo enrichment only when `qualification_score >= 60`; otherwise leave the candidate stored for review.

## Step 2.5: Resolve Pending Leads

Before enriching new leads, check existing `awaiting_phone` leads (same as daily-scout Step 3):

1. Call `leads_search` with `status: "awaiting_phone"`
2. Call `apollo_usage` to check budgets and expire old pending records
3. For each `awaiting_phone` lead that has been resolved by webhook → include it in the next appropriate report, not as a separate immediate email
4. For expired/failed pending leads → web search fallback for phone → update or mark `"needs_human_review"`

## Step 3: Enrich Each Lead via Apollo

For each person that passes the P&C filter:

1. **LinkedIn:** `web_search` for `"<full name>" "<company>" site:linkedin.com/in`
2. **Company HQ:** `web_search` for `"<company>" headquarters address insurance`
3. **Geography:** Check the article, LinkedIn profile, or company website
4. **Browser fallback:** For JS-heavy or blocked pages, use `browser` with `profile: "openclaw"` and `snapshotFormat: "ai"` to extract only the missing facts.
5. **Functional focus:** Infer from title (VP Distribution → distribution, AVP Underwriting → underwriting, etc.)
6. **Apollo Enrichment:** Batch leads via `apollo_bulk_enrich` (groups of up to 10) with first_name, last_name, organization_name, domain (if known), linkedin_url (if known), `source_type: "newsletter"`, `qualification_score`, and `qualification_reason`
7. Based on results:
   - **`deliver: true`** → `leads_upsert` with email + phone + status `"new"`, include in reply CSV
   - **`status: "awaiting_phone"`** → `leads_upsert` with email + status `"awaiting_phone"`. Phone webhook arrivals are stored silently and included in the next daily report.
   - **`status: "qualification_rejected"`** → leave the candidate stored; do not retry Apollo without better evidence or explicit Darryl/Mindlink direction.
   - **`status: "no_email"` or `"no_match"`** → web search fallback (see lead-enrich skill for queries). Deliver only if BOTH email and phone found.
   - **`status: "budget_exhausted"`** → web search fallback for both email and phone

## Step 4: Store Leads

Call `leads_upsert` for each lead. Set status based on contact info:

- `"new"` — both email AND phone confirmed
- `"awaiting_phone"` — email found, phone pending (async or web search)
- `"needs_human_review"` — no contact info found

Set source info to reference the newsletter:

```json
{
  "full_name": "Colleen Hurley",
  "current_title": "VP, Business Development",
  "current_company": "Howden U.S.",
  "source_published_date": "<newsletter date>",
  "move_type": "new_employer",
  "status_pipeline": "new",
  "sources": [
    {
      "source_url": "<newsletter URL or 'Forwarded: Business Insurance Comings & Goings'>",
      "source_label": "Business Insurance - Comings & Goings",
      "published_on": "<newsletter date>"
    }
  ]
}
```

## Step 5: Reply to Darryl

Send a summary email back to Darryl using `email_send`:

**Subject:** `Newsletter Processed — [N] Complete Leads from [Newsletter Name]`
**Body:**

```
I processed the [Newsletter Name] digest you forwarded ([date]).

Results:
- Total people mentioned: [N]
- Complete leads (email + phone): [N] — see attached CSV
- Phone lookup in progress: [N] — these will be included once complete
- Stored candidates below enrichment threshold: [N]
- Non-P&C or low-confidence skipped: [N]
- Non-US eliminated: [N]
- Needs human review: [N]

Complete Leads:
1. [Name] — [Title] @ [Company] (email + phone confirmed)
2. [Name] — [Title] @ [Company] (email + phone confirmed)
...

Skipped (non-P&C, non-US, or low-confidence):
- [Name] — [Title] @ [Company] (reason: life insurance only)
...
```

Attach CSV with `email_send_csv` containing ONLY the complete leads (both email and phone confirmed).

## Edge Cases

- **No names found:** Reply to Darryl saying the email didn't contain recognizable people moves and ask if the format is different than expected.
- **PDF attachment:** Note that you cannot parse PDF attachments directly. Ask Darryl to copy-paste the text content.
- **Ambiguous roles:** If a title could be either P&C or life/health, store with `needs_human_review` and note the ambiguity.
- **Duplicate leads:** The `leads_upsert` tool handles deduplication automatically. Note in the reply how many were already in the database.
- **International list:** If the entire list appears to be non-US (e.g., EMEA awards, London Market), note this to Darryl and suggest the US equivalent if one exists. Do not process non-US names as leads.
