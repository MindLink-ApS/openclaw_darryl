---
name: lead-enrich
description: Enrich a lead with additional data — LinkedIn profile, company HQ address, geography, functional focus, and contact info from public sources. Use when asked to enrich or look up more details on a specific lead.
metadata:
  openclaw:
    emoji: "🔎"
    always: true
---

# Lead Enrich — Add Details to Existing Leads

Run this skill when Darryl asks to enrich a lead, look up more details, or when you need to fill in gaps on a stored lead.

## Step 1: Identify the Lead

If Darryl specifies a name or ID:
1. Call `leads_search` with the name/company to find the lead
2. Review what fields are already populated vs. missing

## Step 2: Search for Missing Data

For each missing field, run targeted searches:

### LinkedIn Profile (if missing)
```
web_search: "<full name>" "<company>" site:linkedin.com/in
```
If found, use `web_fetch` to read the public profile for additional details.

### Company HQ Address (if missing)
```
web_search: "<company>" headquarters address
```
Check the company's official website, Wikipedia, or business directories.

### Geography (if missing)
Look for location info in:
1. LinkedIn profile (if found)
2. Company "About" page
3. The original source article
4. State insurance department records

### Functional Focus (if missing)
Infer from title and company context:
- VP Distribution / VP Sales → "distribution"
- AVP Underwriting / Chief Underwriting Officer → "underwriting"
- Regional Director → "regional operations"
- Head of Development / CDO → "business development"
- Claims VP → "claims"

### Email Address (approach with caution)
Only source from:
- Official company bio page
- Public press release with contact info
- Conference speaker bio
- Published vCard

**Never** guess email patterns (e.g., firstname.lastname@company.com). **Never** fabricate.

### Mobile Phone
Only source from:
- Official directory listings
- Published conference speaker info
- Public bio with explicit phone number

**Never** guess or fabricate phone numbers.

## Step 3: Update the Lead

Call `leads_upsert` with the same identifying fields (name, company, title, source_published_date) plus the newly found data. The dedup logic will merge the update into the existing record.

Add any new sources found during enrichment:
```json
{
  "sources": [
    {
      "source_url": "https://linkedin.com/in/janesmith",
      "source_label": "LinkedIn Profile"
    }
  ]
}
```

## Step 4: Report Back

If Darryl asked for this enrichment directly, reply via `email_send` with what was found and updated. Note any fields that couldn't be found.

## Compliance Reminders

- Only use public, lawful sources
- Respect robots.txt and site ToS
- Never bypass paywalls or authentication
- If a person's LinkedIn indicates "do not contact" or similar, flag with `leads_update_pipeline` → `do_not_contact`
- Always record source URLs for audit trail
