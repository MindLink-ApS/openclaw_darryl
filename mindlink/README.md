# /mindlink — openclaw_darryl

This folder is the project operating pack for agents and humans.

## Ownership

| System             | Owns                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------- |
| GitHub `/mindlink` | Dev/project truth, plan, decisions, evidence index, taskqueue progress                   |
| ClickUp            | Gantt/dashboard only: deadline, money tag/value, summary, status, `% taskqueue complete` |
| Slack `#agent-ops` | Grouped approvals and exceptions                                                         |
| Google Workspace   | Evidence: meetings, docs, Drive files, Gmail references                                  |
| Atlas memory       | Synthesis/history, not raw dumps                                                         |

If ClickUp disagrees with `/mindlink/plan.md`, `/mindlink` wins.

## Migration State

- Installed by: MindLink factory migration sweep
- Gap assessment: high migration risk, high orphan risk
- Legacy docs: preserved in place; do not delete in the first migration PR

## Files

| File                           | Purpose                                                 | Primary writer      |
| ------------------------------ | ------------------------------------------------------- | ------------------- |
| `vision.md`                    | Long-term client/project success definition             | Atlas + humans      |
| `context.md`                   | Current truth, constraints, non-goals, key links        | Atlas               |
| `plan.md`                      | Milestones, taskqueue, acceptance criteria, progress %  | Atlas + Forge/Codex |
| `development-manifest.md`      | Architecture, commands, QA/deploy rules                 | Forge/Codex         |
| `darryl-hermes-gcp-runbook.md` | Darryl HERMES/GCP cutover and validation runbook        | Atlas + Forge/Codex |
| `decisions.md`                 | Approved decisions with source links                    | Atlas               |
| `evidence.md`                  | Index of Google/GitHub/Slack evidence; links, not dumps | Atlas               |
| `skills.md`                    | Required reasoning lenses and when to use them          | Humans + Atlas      |
| `timesheet.md`                 | Lightweight work evidence from Calendar/GitHub          | Atlas               |

## Anti-Bloat Rules

- No raw meeting transcripts unless explicitly approved.
- No raw Slack thread dumps.
- No duplicate ClickUp exports.
- No secrets, rates, margins, or private billing.
- No file should grow beyond 250 lines without condensation.
- Every entry must help the next agent make a better decision.
