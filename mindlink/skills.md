# Agent Skills — openclaw_darryl

## Required Lenses

| Situation                     | Required Lens          | Output                                             |
| ----------------------------- | ---------------------- | -------------------------------------------------- |
| New plan or sprint scope      | Steelman               | Best interpretation, assumptions, recommended path |
| High-risk or ambiguous change | `/the-fool` pre-mortem | Failure modes, mitigations, go/no-go               |
| Code changes                  | Code review            | Bugs, regressions, tests, security                 |
| UI changes                    | Prism review           | Layout, accessibility, performance, copy           |
| Client-facing message         | Evidence audit         | Claims checked against evidence                    |

## Cost Discipline

- Use deterministic repo/context reads before long reasoning.
- Use Claude for voice-derived compiled plans and high-value planning.
- Use cross-vendor review only for production code, deploys, money, client-facing
  messages, multi-client context, or serious ambiguity.
- Do not run deep reviews on routine low-risk edits.

## Agent Prompt Rule

When an agent reads this repo, it should state which lens it is applying and why.
If no lens is needed, it should say the task is low-risk and proceed directly.
