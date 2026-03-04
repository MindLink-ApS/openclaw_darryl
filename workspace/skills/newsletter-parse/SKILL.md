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
2. Is the title a target title? (CDO, VP, Regional Director, AVP, BD, Underwriter)
3. If both are uncertain, mark as `needs_human_review` but still store the lead

## Step 3: Enrich Each Lead

For each person that passes the P&C filter:

1. **LinkedIn:** `web_search` for `"<full name>" "<company>" site:linkedin.com/in`
2. **Company HQ:** `web_search` for `"<company>" headquarters address insurance`
3. **Geography:** Check the article, LinkedIn profile, or company website
4. **Functional focus:** Infer from title (VP Distribution → distribution, AVP Underwriting → underwriting, etc.)
5. **Email:** Search company team page and direct name search (see lead-enrich skill for full query list). Validate domain match and person match before storing.
6. **Phone:** Search company directory and speaker bios (see lead-enrich skill for full query list). Validate before storing.

## Step 4: Store Leads

Call `leads_upsert` for each lead. Set source info to reference the newsletter:

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

**Subject:** `Newsletter Processed — [N] Leads Extracted from [Newsletter Name]`
**Body:**

```
I processed the [Newsletter Name] digest you forwarded ([date]).

Results:
- Total people mentioned: [N]
- P&C target leads stored: [N]
- Non-P&C or non-target skipped: [N]
- Needs human review: [N]

Leads Stored:
1. [Name] — [Title] @ [Company] ✓
2. [Name] — [Title] @ [Company] ✓
3. [Name] — [Title] @ [Company] ⚠️ needs review (uncertain P&C relevance)
...

Skipped (non-P&C or non-target title):
- [Name] — [Title] @ [Company] (reason: life insurance only)
...

All leads have been added to your database. Use "export my leads" to get an updated CSV.
```

## Edge Cases

- **No names found:** Reply to Darryl saying the email didn't contain recognizable people moves and ask if the format is different than expected.
- **PDF attachment:** Note that you cannot parse PDF attachments directly. Ask Darryl to copy-paste the text content.
- **Ambiguous roles:** If a title could be either P&C or life/health, store with `needs_human_review` and note the ambiguity.
- **Duplicate leads:** The `leads_upsert` tool handles deduplication automatically. Note in the reply how many were already in the database.
