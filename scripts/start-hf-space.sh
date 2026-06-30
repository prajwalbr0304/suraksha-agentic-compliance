#!/bin/sh
set -eu

export PORT="${PORT:-7860}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"
export AGENT_HOST="${AGENT_HOST:-127.0.0.1}"
export AGENT_PORT="${AGENT_PORT:-8088}"
export AGENT_SERVICE_URL="${AGENT_SERVICE_URL:-http://127.0.0.1:${AGENT_PORT}}"
export ENABLE_SCHEDULER="${ENABLE_SCHEDULER:-0}"

if [ -z "${SUPABASE_URL:-}" ] && [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]; then
  export SUPABASE_URL="${NEXT_PUBLIC_SUPABASE_URL}"
fi

cleanup() {
  if [ -n "${AGENT_PID:-}" ]; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
}
trap cleanup INT TERM EXIT

(
  cd /app/agent-service
  /opt/suraksha-agent-venv/bin/python -m uvicorn app.main:app --host "$AGENT_HOST" --port "$AGENT_PORT"
) &
AGENT_PID="$!"

echo "Suraksha agent service starting on ${AGENT_SERVICE_URL}"
echo "Suraksha web app starting on 0.0.0.0:${PORT}"

npm run start -- -H "$HOSTNAME" -p "$PORT"
