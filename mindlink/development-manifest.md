# Development Manifest — openclaw_darryl

## Stack

- Runtime: Node.js / JavaScript detected from package.json
- Framework: Express, TypeScript
- Database: not detected
- Hosting: verify from repo deployment config

## Commands

```bash
npm run dev
npm run build
npm run lint
npm run test
```

## Architecture Map

| Area       | Files  | Notes                         |
| ---------- | ------ | ----------------------------- |
| App entry  | verify | inspect before implementation |
| Routing    | verify | inspect before implementation |
| Data layer | verify | inspect before implementation |
| Auth       | verify | inspect before implementation |
| Deployment | verify | inspect before implementation |

## Quality Gates

- Run the commands above when applicable before PR review.
- UI-facing work requires Prism review.
- Production deploys require explicit approval if risk is material.
- External/client-facing claims must cite evidence.
- Forge/Codex must not deploy or message clients directly.

## Known Sharp Edges

| Area      | Risk                                       | How To Verify        |
| --------- | ------------------------------------------ | -------------------- |
| Migration | old project truth may be split across docs | review `evidence.md` |
| Secrets   | repo-specific env may not be provisioned   | run Forge doctor     |

## Agent Implementation Rule

Before changing code, Forge/Codex should run a concise plan, then challenge it
with `/the-fool` when the change is high-risk, ambiguous, or production-facing.
