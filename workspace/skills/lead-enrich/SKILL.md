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

### Email Address

Run these searches in order, stopping when a verified email is found:

1. **Company team/leadership page:**

   ```
   web_search: "<company>" "leadership" OR "our team" OR "executive team"
   ```

   If found, `web_fetch` the page and look for the person by name. Company team pages are the highest-yield source for executive email addresses.

2. **Direct name + email search:**

   ```
   web_search: "<full name>" "<company>" email
   ```

3. **Industry directories and conference bios:**

   ```
   web_search: "<full name>" email site:rims.org OR site:cpcusociety.org OR site:insurancejournal.com
   web_search: "<full name>" "<company>" "speaker" OR "panelist" OR "presenter" email
   ```

4. **Press releases with media contacts:**

   ```
   web_search: "<full name>" "<company>" "media contact" OR "press contact" OR "for more information"
   ```

5. **Professional association and regulatory directories:**
   ```
   web_search: "<full name>" email site:naic.org OR site:ambest.com
   ```

For any email found, validate before storing:

- The email appears on a page that names the same person at the same company
- The email domain matches the company's known domain (not a personal Gmail/Yahoo)
- It is a personal business email, not a generic address (skip info@, contact@, hr@, media@)
- Record the source URL in the `sources` array

**Never** guess email patterns (e.g., firstname.lastname@company.com). **Never** fabricate.

### Phone Number

Run these searches, stopping when a verified number is found:

1. **Company directory or team page** (often the same page found during email search):

   ```
   web_search: "<full name>" "<company>" phone OR "direct line" OR "contact"
   ```

2. **Conference speaker bios:**

   ```
   web_search: "<full name>" "<company>" "speaker" phone
   ```

3. **Industry directories:**
   ```
   web_search: "<full name>" phone site:ambest.com OR site:naic.org
   web_search: "<company>" "<full name>" directory phone
   ```

For any phone number found, validate before storing:

- The number appears on a page that names the same person at the same company
- It is a direct/personal number, not a main switchboard or general company line
- Record the source URL in the `sources` array

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
    },
    {
      "source_url": "https://chubb.com/about/leadership",
      "source_label": "Company Leadership Page (email, phone)"
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
