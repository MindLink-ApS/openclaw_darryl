# Context — openclaw_darryl

## Current Truth

- Current phase: migration scaffold; Atlas must confirm active project state.
- Current owner: MindLink / Atlas-mediated.
- Current production URL: unknown.
- Current repo: https://github.com/MindLink-ApS/openclaw_darryl.git
- Current branch: main
- Current ClickUp dashboard card: verify in ClickUp.
- Current Drive folder: verify in Google Workspace.

## Migration Risk Snapshot

- Migration: No root /mindlink directory is present.
- Migration: Legacy mindlink.md/ exists and needs review before introducing /mindlink.
- Migration: 3 legacy source-of-truth file(s) need mapping.
- Migration: docs/ has at least 500 files and needs bounded evidence mapping.
- Orphan: Legacy mindlink.md/ may be orphaned if /mindlink is introduced without merge review.
- Orphan: Planning docs exist without complete /mindlink context and plan coverage.
- Orphan: docs/ contains knowledge without complete evidence/development-manifest coverage.

## Existing Truth Inventory

| source       | purpose                                  | state                                   |
| ------------ | ---------------------------------------- | --------------------------------------- |
| CLAUDE.md    | agent-instructions, claude-only-context  | preserve and map                        |
| AGENTS.md    | agent-instructions, shared-agent-context | preserve and map                        |
| VISION.md    | vision                                   | preserve and map                        |
| docs/        | 500+ file(s)                             | index evidence, do not dump raw content |
| mindlink.md/ | 3 file(s)                                | merge by topic, then archive note       |

## Constraints

- Must preserve: old PRDs, specs, scope notes, decisions, meeting summaries, and agent instructions.
- Must not touch: secrets, raw transcripts, private billing, rates, margins, unrelated legacy docs.
- Known risk: stale or split project truth if old docs are ignored.
- Unknowns: current deadline, client priority, exact active milestone, and latest approval state.

## Active Project State

| Area              | State                        | Evidence                   |
| ----------------- | ---------------------------- | -------------------------- |
| Product           | needs Atlas confirmation     | legacy inventory           |
| Design/UX         | needs Atlas confirmation     | legacy inventory           |
| Engineering       | needs Forge/Codex assessment | repo files                 |
| Deployment        | needs manifest confirmation  | repo config                |
| Client/commercial | keep internal                | ClickUp/Workspace, not Git |

## Open Questions

| Question                                       | Needed From          | Blocks                      |
| ---------------------------------------------- | -------------------- | --------------------------- |
| What is the current active milestone?          | Atlas / ClickUp      | autonomous Forge day plan   |
| Which legacy docs are canonical vs historical? | Atlas / human review | high-confidence `vision.md` |
| What QA command is mandatory before PR?        | Forge/Codex          | factory mode                |
