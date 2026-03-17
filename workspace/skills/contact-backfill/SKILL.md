---
name: contact-backfill
description: Batch backfill missing contact info (email + phone) for all leads in the database. Searches for office phone numbers, company main lines, and infers email addresses from same-company patterns. Run after daily-scout or on demand.
metadata:
  openclaw:
    emoji: "📇"
    always: true
---

# Contact Backfill — Fill Gaps in Existing Leads

Run this skill to systematically go through all leads that are missing contact information and attempt to fill the gaps. This is a batch operation — it processes every incomplete lead, not just one.

## When to Run

- After each daily-scout cycle (as a follow-up enrichment pass)
- When Darryl asks to backfill or update contact info for existing leads
- Periodically via cron to catch leads where Apollo async never resolved

## Step 1: Find Incomplete Leads

Query for all leads that are missing email, phone, or both:

1. Call `leads_search` with `status: "awaiting_phone"` — these have email but no phone
2. Call `leads_search` with `status: "needs_human_review"` — these may be missing both
3. Also call `leads_search` with `status: "new"` and review any that have one field empty (edge cases)

Combine results into a work list. Skip leads with status `do_not_contact`.

## Step 2: Backfill Phone Numbers

For each lead missing `mobile_phone`, run this search chain (stop when a usable number is found):

### 2a. Person's Office Direct Line

```
web_search: "<full name>" "<company>" "direct" OR "office" phone
web_search: "<full name>" "<company>" "ext" OR "extension" phone
```

Check company leadership/team pages — these often list office extensions.

### 2b. Company Office Number for That City

If no direct line is found, search for the company's main office in the lead's geography:

```
web_search: "<company>" "<city>" OR "<state>" office phone number
web_search: "<company>" "<city>" "main" OR "general" phone
```

Also try:

- Company "Contact Us" or "Locations" page: `web_search: "<company>" "contact us" OR "locations"`
- Use `web_fetch` on the company website contact page to find regional office numbers

### 2c. Validation and Storage

- Accept direct lines, office numbers, and main company lines (in that priority order)
- **Do NOT reject a number just because it's a main office line** — it's better than nothing
- Store the phone in `mobile_phone` (this field serves as the general contact phone)
- Add a note in `notes` describing the phone type:
  - Direct line found → `"phone: office direct line"`
  - Main office found → `"phone: main office (<city>)"`
- Record the source URL where the number was found

## Step 3: Backfill Email Addresses

For each lead missing `email_address`, run this search chain:

### 3a. Direct Web Search (standard)

```
web_search: "<full name>" "<company>" email
web_search: "<company>" "leadership" OR "our team" email
web_search: "<full name>" email site:rims.org OR site:ambest.com
```

If found and validated (domain matches company, not generic), store it and move on.

### 3b. Email Pattern Inference (when web search fails)

If no email was found via web search, infer one from same-company leads:

1. **Query same-company leads:** Call `leads_search` with `company: "<company name>"` to find all leads at the same company
2. **Collect known emails:** From the results, gather every `email_address` that is populated and NOT already marked as suggested
3. **Detect the pattern:** Analyze the email format. Common patterns:
   - `first.last@domain.com` (e.g., john.smith@acmeins.com)
   - `firstlast@domain.com` (e.g., johnsmith@acmeins.com)
   - `flast@domain.com` (e.g., jsmith@acmeins.com)
   - `first_last@domain.com` (e.g., john_smith@acmeins.com)
   - `first@domain.com` (e.g., john@acmeins.com)
   - `firstl@domain.com` (e.g., johns@acmeins.com)
   - `last.first@domain.com` (e.g., smith.john@acmeins.com)
4. **Require at least 1 example** to establish a pattern. 2+ examples with the same pattern = high confidence.
5. **Generate the suggestion:** Apply the detected pattern to the lead's name. For example, if the pattern is `first.last@acmeins.com` and the lead is "Jane Doe", suggest `jane.doe@acmeins.com`.
6. **Store as suggested:**
   - Set `email_address` to the inferred email
   - Append to `notes`: `"email suggested based on company pattern (first.last@domain.com) — verify before outreach"`

### 3c. No Pattern Available

If the company has no other leads with emails (no pattern to infer from):

1. Try to find the company's email domain from their website: `web_search: "<company>" insurance email "@"`
2. If a domain is found but no pattern, note the domain in `notes`: `"company email domain: @acmeins.com — email not confirmed"`
3. Do NOT generate an email without a pattern — leave `email_address` empty

## Step 4: Update Leads and Advance Pipeline

For each lead that was backfilled:

1. Call `leads_upsert` with the new contact data
2. Update `status_pipeline` based on what was found:
   - **Both email AND phone now populated** → `"new"` (passes delivery gate)
   - **Email found/suggested, still no phone** → keep `"awaiting_phone"`
   - **Phone found, still no email** → keep `"needs_human_review"`
   - **Neither found** → keep current status

## Step 5: Report Results

After processing all incomplete leads, prepare a summary:

- Total leads processed
- Leads that became complete (both email + phone) — these are now deliverable
- Leads with suggested emails (note the pattern used)
- Leads with office/main phone numbers (vs. direct lines)
- Leads still incomplete — what's missing and why

If any leads became complete, include them in the next report to Darryl or send an immediate notification if the count is significant (3+).

## Compliance Notes

- Office phone numbers and company main lines are public information — safe to use
- Suggested emails are clearly marked as inferred, not verified
- Darryl should verify suggested emails before using them for cold outreach
- All source URLs must be recorded for audit trail
- Never fabricate phone numbers — only use numbers found on actual web pages
