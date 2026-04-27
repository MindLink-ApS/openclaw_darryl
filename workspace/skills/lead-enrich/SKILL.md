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
If `web_fetch` is blocked or too thin, use `browser` with `profile: "openclaw"` and `snapshotFormat: "ai"` to extract only the public profile facts needed.

### Company HQ Address (if missing)

```
web_search: "<company>" headquarters address
```

Check the company's official website, Wikipedia, or business directories.
Use `browser` only when `web_fetch` cannot read the official site or directory page. Firecrawl is not available.

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

### Email + Phone — Apollo Enrichment (Primary)

Before running manual web searches for email and phone, use Apollo as the primary enrichment source only after the economical qualification gate:

1. **Check current data** — does the lead already have both email AND phone?
   - Yes → skip Apollo, report "already fully enriched"
   - Has email, no phone, status `"awaiting_phone"` → check if webhook has delivered (lead may have been promoted to `"new"` already). If still pending < 2h, tell Darryl "phone lookup is in progress." If pending >= 2h, continue to web search fallback below.
   - Missing email or phone → continue to step 2

2. **Store/score candidate** — call `lead_candidates_upsert` with `source_type`, source evidence, missing fields, and `qualification_score`

3. **Check budget** — call `apollo_usage` to verify sync credits remain

4. **Call `apollo_enrich`** with first_name, last_name, organization_name, domain (if known), linkedin_url (if known), internal_lead_id (the lead's ID from leads_search), `source_type`, `qualification_score`, and `qualification_reason`

5. **Handle results:**
   - **`deliver: true`** (both email + phone found) → `leads_upsert` with email + phone + status `"new"`. If Darryl directly asked for this specific enrichment, email him the complete lead; otherwise include it in the next report.
   - **`status: "awaiting_phone"`** (email found, async phone hunt triggered) → `leads_upsert` with email + status `"awaiting_phone"`. Tell Darryl only if this was a direct reply: "Found email for [Name]. Phone lookup is in progress."
   - **`status: "qualification_rejected"`** → do not retry Apollo with the same evidence; improve public-source validation or leave the candidate for review.
   - **`status: "no_email"` or `"no_match"`** → continue to manual web search below
   - **`status: "budget_exhausted"`** → continue to manual web search below

### Email + Phone — Web Search Fallback

Only used when Apollo couldn't find data. Run these searches:

**Email** (in order, stop when found):

1. Company team/leadership page: `web_search: "<company>" "leadership" OR "our team"`
2. Direct search: `web_search: "<full name>" "<company>" email`
3. Industry directories: `web_search: "<full name>" email site:rims.org OR site:ambest.com`
4. Press releases: `web_search: "<full name>" "<company>" "media contact" email`

**Phone** (in order, stop when found):

1. Company directory: `web_search: "<full name>" "<company>" phone OR "direct line"`
2. Speaker bios: `web_search: "<full name>" "<company>" "speaker" phone`
3. Industry directories: `web_search: "<full name>" phone site:ambest.com OR site:naic.org`
4. Office direct line: `web_search: "<full name>" "<company>" "direct" OR "office" OR "ext" phone`
5. Company main office for lead's city/geography:
   ```
   web_search: "<company>" "<city>" OR "<state>" office phone number
   web_search: "<company>" "contact us" OR "locations"
   ```
   Use `web_fetch` on the company contact page to find the relevant office number. Accept main office lines as a fallback — note the type in `notes` (e.g., `"phone: main office (Nashville)"`).
   If `web_fetch` cannot extract the contact page, use `browser` with `profile: "openclaw"` and an efficient AI snapshot before giving up.

**Email Pattern Inference** (when all web searches above fail):

If no email was found via web search or Apollo, attempt to infer one from same-company leads:

1. Call `leads_search` with `company: "<company name>"` to find other leads at the same company
2. Collect all populated `email_address` values that are NOT already suggested
3. Detect the naming pattern (e.g., `first.last@domain.com`, `flast@domain.com`)
4. If at least 1 example exists, apply the pattern to generate a suggested email
5. Store the suggested email in `email_address` and append to `notes`: `"email suggested based on company pattern (first.last@domain.com) — verify before outreach"`
6. If no same-company emails exist, try to find the company domain via `web_search: "<company>" insurance email "@"` and note it in `notes` without generating an email

**Validate** any contact details found via web search:

- Email domain must match the company's domain (not personal Gmail/Yahoo)
- Skip generic addresses (info@, contact@, hr@, media@)
- For phone: prefer direct/personal numbers, but accept office and main company lines as fallbacks
- Record the source URL in the `sources` array
- **Never** fabricate phone numbers — only use numbers found on actual web pages
- Suggested emails must always be noted in `notes` as inferred

## Step 3: Update the Lead

Call `leads_upsert` with the newly found data. The dedup logic merges into the existing record.

**Critical:** Only set `status_pipeline: "new"` if BOTH email AND phone are now populated. If only one was found, set `"awaiting_phone"` (email only) or `"needs_human_review"` (phone only or neither).

## Step 4: Report Back

If Darryl asked for this enrichment directly:

- **Both email + phone found** → reply via `email_send` with the complete lead details
- **Email found, phone pending** → reply: "Found email for [Name]. Phone lookup is in progress. I'll include the complete lead once the phone is confirmed."
- **Neither found** → reply with what data was gathered (LinkedIn, company HQ, geography) and note that contact details couldn't be verified from available sources

## Compliance Reminders

- Only use public, lawful sources
- Respect robots.txt and site ToS
- Never bypass paywalls or authentication
- If a person's LinkedIn indicates "do not contact" or similar, flag with `leads_update_pipeline` → `do_not_contact`
- Always record source URLs for audit trail
