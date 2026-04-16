#!/bin/sh
# Container entrypoint wrapper.
# 1. Seeds recurring cron jobs
# 2. Starts the gateway in background
# 3. Waits for /healthz to return 200
# 4. Triggers an immediate daily-scout run (catch-up for Darryl)
# 5. Waits on gateway PID (keeps container alive)

set -e

# 1. Seed recurring cron jobs into persistent state
sh /app/scripts/seed-crons.sh

# 2. Start gateway in background
echo "start.sh: launching gateway..."
node /app/openclaw.mjs gateway --allow-unconfigured --bind lan &
GATEWAY_PID=$!

# 3. Wait for gateway to be healthy (max 120s)
PORT="${OPENCLAW_GATEWAY_PORT:-10000}"
HEALTH_URL="http://127.0.0.1:${PORT}/healthz"

echo "start.sh: waiting for gateway at ${HEALTH_URL}..."
READY=0
i=0
while [ $i -lt 60 ]; do
  i=$((i + 1))
  if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
    echo "start.sh: gateway healthy after ${i} attempts"
    READY=1
    break
  fi
  sleep 2
done

if [ "$READY" = "1" ]; then
  # 4. Trigger immediate daily-scout run (catch-up email to Darryl)
  echo "start.sh: triggering immediate daily-scout run..."
  (sleep 5 && node /app/openclaw.mjs cron run daily-scout 2>&1 || echo "start.sh: cron run daily-scout failed (non-fatal)") &
else
  echo "start.sh: WARNING — gateway did not become healthy within 120s. Skipping kick-start."
fi

# 5. Foreground the gateway — this keeps the container alive
wait $GATEWAY_PID
