# Plan — openclaw_darryl

## Dashboard Projection

These fields are mirrored to ClickUp. Keep them compact.

- Deadline: verify in ClickUp.
- Money/value tag: keep in internal systems or ClickUp only.
- Summary: 🦞 OpenClaw — Personal AI Assistant
- Status: needs intervention
- Taskqueue progress: 0%
- Current milestone: /mindlink migration and factory readiness.
- Human blocker: Atlas must review gap assessment and current client priority.

## Current Sprint Anchor

- Goal: preserve project truth, then enable safe Forge/Codex factory work.
- Why now: client repos need one durable project source of truth before autonomous sessions.
- Definition of done: gap assessment reviewed, `/mindlink` accepted, Forge doctor passes, first work pack approved.
- Expected Forge/Codex actions today: none until Atlas approves a scoped work pack.
- Human approval needed: approve this migration and current milestone interpretation.

## Taskqueue

| ID     | Status  | Task                                             | Owner         | Acceptance Criteria                         | Evidence       |
| ------ | ------- | ------------------------------------------------ | ------------- | ------------------------------------------- | -------------- |
| TQ-001 | review  | Review gap assessment and legacy truth inventory | Atlas         | No old mission/PRD/spec is orphaned         | `evidence.md`  |
| TQ-002 | pending | Confirm active client milestone and deadline     | Atlas         | ClickUp dashboard agrees with this plan     | ClickUp card   |
| TQ-003 | pending | Run Forge runner doctor for this repo            | Forge         | Codex auth and repo secret isolation pass   | doctor output  |
| TQ-004 | pending | Approve first Forge/Codex work pack              | Atlas + human | Work pack names allowed files, QA, rollback | Slack approval |

Status values: `pending`, `in_progress`, `review`, `blocked`, `done`.

## Milestones

| Milestone               | Target Date | Status  | Notes                          |
| ----------------------- | ----------- | ------- | ------------------------------ |
| Project truth migration | TBD         | review  | Legacy docs preserved in place |
| Factory readiness       | TBD         | pending | Requires doctor pass           |

## Risks And Blockers

| Risk/Blocker                                           | Severity | Owner | Next Action                       |
| ------------------------------------------------------ | -------- | ----- | --------------------------------- |
| Legacy docs may contain newer truth than this scaffold | high     | Atlas | Review evidence before Forge work |
| Per-repo secrets may be missing                        | high     | Forge | Run doctor before factory mode    |
| ClickUp may disagree with GitHub truth                 | medium   | Atlas | Reconcile dashboard projection    |
