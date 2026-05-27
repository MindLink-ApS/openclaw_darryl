# Darryl Emma HERMES GCP Runbook

## Purpose

Move Darryl's Emma Jones production assistant from Render/OpenClaw to a dedicated
Google Compute Engine VM running HERMES as the primary runtime, without losing
relationship continuity, report cadence, lead history, Apollo budget state, or
email context.

This file is an operator runbook. Do not paste raw mailbox bodies, transcript
dumps, secrets, rates, or private billing data here.

## Architecture Decision

- Tenancy: one VM per client trust boundary. Darryl gets a dedicated VM, disk,
  service account, secrets, runtime, browser profile, and backups.
- Runtime: HERMES primary. OpenClaw remains the source for Emma instructions,
  Darryl-specific plugins, lead schema, and migration reference.
- Public ingress: expose only webhook paths required for Gmail Pub/Sub and
  Apollo phone callbacks. Keep agent API, admin, browser, control, and shell
  surfaces loopback or tailnet only.
- Audit depth: full content audit is approved for migration continuity, but raw
  content stays out of git and public tools.

Relevant source references:

- `config/darryl-config.json`
- `render.yaml`
- `scripts/start.sh`
- `scripts/seed-crons.sh`
- `workspace/AGENTS.md`
- `workspace/HEARTBEAT.md`
- `workspace/SOUL.md`
- `workspace/USER.md`
- `workspace/skills/*/SKILL.md`
- `docs/install/gcp.md`
- `docs/gateway/security/index.md`
- `docs/concepts/session.md`
- `docs/concepts/memory.md`
- HERMES docs: https://hermes-agent.nousresearch.com/docs/
- HERMES API server: https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
- HERMES MCP: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/
- HERMES memory: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
- HERMES skills: https://hermes-agent.nousresearch.com/docs/user-guide/features/skills/
- HERMES fallback providers: https://hermes-agent.nousresearch.com/docs/user-guide/features/fallback-providers/
- HERMES provider routing: https://hermes-agent.nousresearch.com/docs/user-guide/features/provider-routing
- HERMES ACP: https://hermes-agent.nousresearch.com/docs/user-guide/features/acp/

## Pre-Cutover Inventory

Capture these before touching production runtime:

- Current deployed commit/image and Render environment variable names.
- Full `/data/.openclaw` backup, including SQLite sidecars and WAL files.
- Runtime workspace used by production Emma.
- `config/darryl-config.json` as deployed after env expansion.
- Cron jobs and run logs for `daily-scout`, `weekly-digest`, and `monthly-report`.
- Gmail Pub/Sub topic, push subscription, endpoint, and push-token location.
- Apollo webhook base URL, webhook secret location, pending phone callback count,
  and current monthly usage.
- Lead DB counts by status, complete-lead count, candidates by status, and
  do-not-contact count.
- mem0 memory export or structured summary, including exclusions, good
  patterns, report preferences, source quality notes, and onboarding marker.
- Session metadata and approved transcript content needed to preserve cadence
  and voice.
- Last successful daily report, weekly digest, monthly report, and any missed
  delivery incidents.

## Full Content Audit

Allowed for migration:

- Emma inbox bodies from Darryl and trusted MindLink addresses.
- Darryl BCC outreach emails and forwarded newsletters.
- Sent Emma reports and CSV attachment metadata.
- External replies that Emma acknowledged or routed to Darryl.
- Emma session transcripts and memory entries.

Rules:

- Store only summaries, dates, evidence ids, and durable preferences in git.
- Keep raw exports encrypted outside the repo.
- Redact personal contact data unless needed inside the production lead DB.
- Convert durable user preferences into memory entries with provenance and date.
- Mark stale or conflicting instructions for human review instead of silently
  resolving them.

Required audit outputs:

- `relationship-continuity.md` outside git or in the secure handoff vault.
- Darryl preference and exclusion summary for HERMES memory.
- Pending work list: incomplete leads, pending Apollo phones, human-review
  items, external replies needing Darryl action.
- Report cadence summary and expected next send time in America/Chicago.
- Secret custody map listing secret names and storage locations, not values.

## GCP Tenant Shape

Baseline per client:

- GCE VM: start at e2-medium for build/runtime reliability.
- Persistent disk: size for state, browser cache, sessions, SQLite, logs, and
  encrypted local backups. Do not reuse Render's 1 GB sizing.
- OS user: one service user for Darryl's runtime.
- Secrets: Secret Manager or environment refs mounted into the service manager.
- Network: no public port for HERMES API/admin. Use SSH tunnel or Tailscale for
  operator access.
- HTTPS proxy: route only `/gmail-pubsub` and `/apollo-phone-webhook/<secret>`
  to local services.
- Backups: encrypted disk snapshots plus periodic state archives while the
  service is stopped or quiesced.

## No-Outbound Boot

Before the new VM handles production traffic, boot with:

```bash
OPENCLAW_DARRYL_NO_OUTBOUND=1
```

For the current OpenClaw container path, this also sets:

```bash
OPENCLAW_SKIP_CRON=1
OPENCLAW_SKIP_GMAIL_WATCHER=1
```

Available granular controls:

```bash
OPENCLAW_DARRYL_SKIP_CRON_SEED=1
OPENCLAW_DARRYL_SKIP_KICKSTART=1
OPENCLAW_DARRYL_CRON_SEED_OVERWRITE=1
```

Do not enable outbound cron, Gmail watcher, Apollo callbacks, or Darryl-facing
email until all validation checks pass.

## HERMES Primary Runtime Setup

Use HERMES as the production assistant runtime:

- Install HERMES on the VM service user.
- Configure a dedicated HERMES profile for Darryl/Emma.
- Set HERMES API server to loopback only if enabled. Its default host is
  `127.0.0.1`; keep it that way unless it is behind an authenticated private
  proxy. If enabled, store `API_SERVER_KEY` as a secret and keep
  `API_SERVER_CORS_ORIGINS` empty or explicitly allowlisted.
- Configure model/provider fallback through HERMES, preferring strong
  instruction-following models for web/email/tool work.
- Configure HERMES `fallback_providers` for interactive and gateway sessions,
  but do not assume scheduled cron jobs inherit model fallback. Validate the
  exact model/provider used by the daily scout schedule.
- If routing through OpenRouter, set provider-routing controls deliberately:
  prefer stable providers for production, set `require_parameters: true`, and
  set `data_collection: "deny"` unless Darryl explicitly approves otherwise.
- Keep Darryl durable preferences in HERMES memory as compact, provenance-tagged
  entries. HERMES memory is bounded; consolidate instead of dumping raw audit
  content.
- Port Emma skills into HERMES `~/.hermes/skills/` using progressive disclosure
  so large references are loaded only when needed.
- Port Emma instructions into HERMES context/skills:
  - identity and voice from `workspace/SOUL.md` and `workspace/IDENTITY.md`
  - Darryl profile from `workspace/USER.md`
  - operating loop from `workspace/AGENTS.md`
  - heartbeat and scheduled tasks from `workspace/HEARTBEAT.md`
  - skill behavior from `workspace/skills/*/SKILL.md`
- Create a Darryl tool bridge, preferably MCP, that exposes the existing lead,
  email, Apollo, and memory tools to HERMES with the same semantics.
- Configure the Darryl MCP bridge with an explicit include-list. HERMES prefixes
  MCP tools as `mcp_<server>_<tool>`, so validate both the registered names and
  the natural-language tool descriptions before enabling schedules.
- Keep MCP stdio environment minimal. Pass only the Darryl secret names required
  by the bridge; do not pass the whole shell environment into tool servers.

Tool bridge compatibility target:

- `email_send`
- `email_send_csv`
- `email_inbox_check`
- `leads_upsert`
- `leads_search`
- `leads_get`
- `leads_update_pipeline`
- `leads_record_contact`
- `leads_export_csv`
- `leads_stats`
- `lead_candidates_upsert`
- `lead_candidates_search`
- `apollo_enrich`
- `apollo_bulk_enrich`
- `apollo_usage`
- `apollo_set_monthly_limit`
- `mem0_recall`
- `mem0_remember`

## Cutover Order

1. Run the full content audit and produce the handoff summaries.
2. Freeze Render outbound work after a successful daily report.
3. Snapshot Render state and export secret names.
4. Restore state, workspace, lead DB, mem0, Apollo, sessions, and credentials to
   the GCP persistent disk.
5. Start HERMES in no-outbound mode.
6. Validate local health, model auth, memory recall, lead stats, Apollo usage,
   browser, email inbox read, SMTP dry run, and tool bridge list.
7. Update Darryl public base URL and callback routes:
   - `DARRYL_PUBLIC_BASE_URL`
   - Gmail Pub/Sub push endpoint
   - Apollo webhook base URL
8. Keep old Render callback path alive or forwarding until pending Apollo phone
   requests drain.
9. Run one controlled Darryl-side status email test.
10. Enable schedules only after the controlled test passes.
11. Confirm exactly one daily report arrives at the expected Central Time
    cadence with the CSV delivery gate intact.
12. Disable Render runtime after the first successful HERMES daily report.

## Validation Checklist

Required before live traffic:

- HERMES health endpoint OK on loopback.
- No public HERMES admin/API/control route reachable.
- Darryl profile loads Emma identity and Darryl operating rules.
- Tool bridge lists required Darryl tools.
- `leads_stats` returns expected counts.
- `mem0_recall` returns known Darryl preference/onboarding memory.
- `apollo_usage` matches pre-cutover usage.
- Gmail inbox check can read recent mail.
- SMTP dry run or controlled status email succeeds.
- Browser/search/fetch tool path can process Business Insurance homepage.
- Cron/scheduler has exactly one daily, weekly, and monthly Darryl job.
- No automatic `daily-scout` runs during validation.
- First production daily report appears once, not twice.

Rollback conditions:

- More than one Darryl-facing report is sent.
- Email send/read path fails after one retry.
- Lead DB, mem0, or Apollo usage state is missing or inconsistent.
- Public admin/API endpoint is reachable.
- HERMES cannot run the daily scout skill with the required tool bridge.

Rollback action:

- Disable HERMES scheduler and webhook ingress.
- Restore Render webhook endpoints and cron only if Render is still frozen and
  state divergence is understood.
- Do not merge divergent lead DBs manually; export both and reconcile by lead id,
  normalized name/company, source URL, and timestamp.
