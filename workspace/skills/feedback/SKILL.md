---
name: feedback
description: Process Darryl's feedback on leads and search quality. Handles corrections like "this was bad", "don't send me tech people", "this lead is great", and preference updates. Learns patterns to improve future scouting.
metadata:
  openclaw:
    emoji: "💬"
    always: true
---

# Feedback — Learn from Darryl's Corrections

Run this skill when Darryl provides feedback on leads, reports, or search quality.

## Types of Feedback

### 1. Lead Quality Feedback
**Trigger:** "This lead was bad", "Lead #42 is not relevant", "Remove John Smith"

1. Identify the lead — use `leads_search` by name or `leads_get` by ID
2. Determine the action:
   - **Bad lead / not relevant:** `leads_update_pipeline` → `do_not_contact` with reason from Darryl's feedback
   - **Good lead:** `leads_update_pipeline` → `queued_for_outreach` (promote from `new`)
   - **Already contacted:** `leads_record_contact` to track the interaction
3. Store the feedback pattern via `mem0_remember`:
   - "Darryl rejected [Name] at [Company] — reason: [reason]"
   - Include title and company for pattern matching

### 2. Category Exclusions
**Trigger:** "Don't send me people in tech", "Skip life insurance", "No underwriters under AVP level"

1. Parse the exclusion criteria (department, title level, insurance line, geography, etc.)
2. Store as a persistent preference via `mem0_remember`:
   - "EXCLUSION: Darryl does not want leads from [category]. Reason: [reason]. Date: [today]"
3. Search existing leads matching the exclusion, and flag or remove them:
   - `leads_search` with relevant filters
   - `leads_update_pipeline` → `do_not_contact` with reason "Excluded by preference: [category]"
4. Confirm back to Darryl via `email_send`:
   - What was excluded and why
   - How many existing leads were affected
   - "Future scouting will exclude [category]"

### 3. Report Format Preferences
**Trigger:** "I want more detail on geography", "Include the source article links", "Make reports shorter"

1. Store the preference via `mem0_remember`:
   - "REPORT PREFERENCE: Darryl wants [specific change]. Date: [today]"
2. Confirm via `email_send`

### 4. Source Quality Feedback
**Trigger:** "Insurance Journal is always wrong", "PropertyCasualty360 has the best leads"

1. Store the source quality note via `mem0_remember`:
   - "SOURCE QUALITY: [source] rated [good/bad] by Darryl. Reason: [reason]. Date: [today]"
2. This will influence future search prioritization via auto-recall

### 5. Positive Reinforcement
**Trigger:** "Great lead!", "More like this one", "This is exactly what I need"

1. Identify the lead
2. Store the positive pattern via `mem0_remember`:
   - "GOOD PATTERN: Darryl liked [Name] at [Company] — title: [title], company type: [type], geography: [geo]"
3. Use this to prioritize similar leads in future scouting

## After Processing

Always reply to Darryl via `email_send` confirming:
- What feedback was received
- What action was taken
- What will change going forward

## Memory Naming Conventions

Use these prefixes for stored feedback memories so they're easy to recall:
- `EXCLUSION:` — things to avoid
- `GOOD PATTERN:` — things to seek out
- `REPORT PREFERENCE:` — how reports should look
- `SOURCE QUALITY:` — source reliability ratings
- `LEAD FEEDBACK:` — specific lead-level notes
