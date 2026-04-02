# mindlink.md — Agent Memory & Session Data

This directory is the persistent knowledge store for MindLink'\''s AI agent platform.

## Structure
- atlas/ — Project management, scope, milestones, decisions
- forge/ — Architecture decisions, build logs, deployment config

## Rules
- Agents READ any subdirectory for context
- Agents WRITE only to their own subdirectory
- .internal.md files are GITIGNORED (billing/rates)
- Never store secrets here — those live in .env