#!/usr/bin/env bash
# Darryl — deterministic RocketReach discovery + enrichment (NO LLM, ~0 tokens).
# Cost-optimized lead engine: free RR Search (job_change_signal) -> ICP filter ->
# dedup -> metered Lookups (1 credit each, capped by RR_MAX_LOOKUPS_PER_RUN and a
# RR_CREDIT_FLOOR reserve) -> leads DB. Prints a run summary with credit telemetry
# + a zero-yield alert. Wired to the weekday cron.
export PATH="$HOME/.local/bin:$PATH"
cd "$HOME/.hermes/plugins/emma-leads" || exit 1

# Load creds from the Hermes env (RR key required; Apollo optional).
export ROCKETREACH_API_KEY="$(grep '^ROCKETREACH_API_KEY=' "$HOME/.hermes/.env" | head -1 | cut -d= -f2-)"
APO="$(grep '^APOLLO_API_KEY=' "$HOME/.hermes/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
[ -n "$APO" ] && export APOLLO_API_KEY="$APO"

# Tunable budget guards (override in env if desired). ~15 lookups/weekday ≈
# ~75 leads/week ≈ ~300/month — under the ~400/mo credit ceiling, with a 25-credit
# reserve floor so a run never drains the budget to zero.
export RR_MAX_LOOKUPS_PER_RUN="${RR_MAX_LOOKUPS_PER_RUN:-15}"
export RR_CREDIT_FLOOR="${RR_CREDIT_FLOOR:-25}"

echo "=== rr-discovery $(date -u +%Y-%m-%dT%H:%M:%SZ) (cap=$RR_MAX_LOOKUPS_PER_RUN floor=$RR_CREDIT_FLOOR) ==="
exec /home/sinejd/.hermes/hermes-agent/venv/bin/python rr_discovery.py
