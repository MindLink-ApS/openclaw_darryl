# Codex Handoff

## Darryl Emma Production Session - 2026-04-27

Current production work is on `main` and pushed to GitHub.

- Latest implementation commit before this note: `6200879e3 Darryl: add deterministic Comings and Goings scouting`
- Emma's production config is in `config/darryl-config.json`
- Darryl-facing agent instructions live in `workspace/AGENTS.md`, `workspace/HEARTBEAT.md`, and `workspace/skills/*/SKILL.md`
- `workspace/CLAUDE.md` is a symlink to `workspace/AGENTS.md`

## What Changed

Emma now has deterministic Business Insurance discovery guidance:

- Fetch `https://www.businessinsurance.com/` first during daily discovery.
- Parse the `Comings and Goings` section.
- Visit linked person profiles such as `/ppl/<person>/`.
- Treat Business Insurance Comings and Goings and forwarded newsletters as broadened Darryl-requested lead sources.
- Do not require target-title matching for those list sources, but still require U.S. evidence and P&C relevance before Apollo spend.
- Gate Apollo spend at `qualification_score >= 60` for Comings and Goings/newsletter leads and `>= 70` for general daily scout leads.
- Reports should include a Capacity Snapshot with Apollo usage and connector status.
- CSV exports now include stored source label and source URL.

Firecrawl is not available and should not be reintroduced for Darryl. Use native OpenClaw `web_search`, `web_fetch`, and `browser` tools.

## Validation Already Run

Local validation passed after the implementation:

- `corepack pnpm vitest extensions/darryl-leads/src/csv.test.ts extensions/darryl-leads/src/production-config.test.ts extensions/darryl-leads/src/candidates.test.ts`
- `corepack pnpm tsgo`
- `corepack pnpm lint`
- `git diff --check`
- `OPENCLAW_CONFIG_PATH=config/darryl-config.json ... corepack pnpm openclaw config validate`

Business Insurance live smoke test passed:

- Homepage fetch found `Comings and Goings`, `Shelley Rathsam`, and `Company: Trucordia`.
- Shelley Rathsam profile showed Trucordia, April 24, 2026, and VP M&A details.

Production smoke test passed as far as credentials allow:

- `https://openclaw-darryl.onrender.com/__openclaw/control-ui-config.json` returned assistant `Emma Jones` and agent id `emma`.
- `/hooks/gmail`, `/hooks/agent`, and `/gmail-pubsub` are mounted and return `401 Unauthorized` without valid production tokens.
- WebSocket gateway opens and sends `connect.challenge`.
- A known-bad gateway token is rejected with `AUTH_TOKEN_MISMATCH`, confirming token-protected production behavior.

## Current Blocker

A true Darryl-side end-to-end test cannot be completed from this terminal without one of:

- Production `HOOKS_TOKEN`
- Production gateway token or a paired device token
- Render shell/log access
- A controlled real email sent into Emma from Darryl's side

No local `.env` with Darryl production secrets was available. Render CLI was not installed locally. GitHub had no deployment records or Actions runs for `MindLink-ApS/openclaw_darryl`, so Render's deployed commit could not be confirmed through GitHub.

## Safe Darryl-End Test

Ask Darryl to send this from his real email to Emma:

```text
Emma test: please reply with a short status only. Confirm whether you can read this email, search Business Insurance Comings and Goings, and send reports. Do not run a full lead search.
```

If Emma replies, the real Gmail watcher, model path, and outbound email path are working from Darryl's side.

## Notes For Next Operator

- Do not trigger production daily scout blindly unless Darryl expects an email.
- Do not send external test emails or hook messages unless the token and recipient behavior are explicitly controlled.
- `scripts/start.sh` triggers an immediate `daily-scout` catch-up after gateway health on startup; redeploying can send Darryl a report.
- `render.yaml` uses `/app/config/darryl-config.json`, `/app/workspace`, persistent state at `/data/.openclaw`, and generated `HOOKS_TOKEN` / `OPENCLAW_GATEWAY_TOKEN`.
