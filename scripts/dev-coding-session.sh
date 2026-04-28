#!/usr/bin/env bash
# Start everything needed to develop/test the coding-session feature.
#
# Usage:
#   ./scripts/dev-coding-session.sh          # start all
#   ./scripts/dev-coding-session.sh stop     # tear down
#
# Requires: docker, node ≥ 22, pnpm, claude CLI authenticated

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

COMPOSE_FILE="$REPO_ROOT/packages/agents-server/docker-compose.dev.yml"
COMPOSE_PROJECT="electric-agents-dev"
AGENTS_SERVER_PORT="${ELECTRIC_AGENTS_PORT:-4437}"
BUILTIN_PORT="${ELECTRIC_AGENTS_BUILTIN_PORT:-4448}"
UI_PORT="${UI_PORT:-5173}"
WORK_DIR="${ELECTRIC_AGENTS_WORKING_DIRECTORY:-/tmp/coding-session-test}"
AGENTS_SERVER_URL="http://localhost:$AGENTS_SERVER_PORT"
PG_PORT="${PG_HOST_PORT:-5432}"
ELECTRIC_PORT="${ELECTRIC_HOST_PORT:-3060}"

# ── Stop mode ──────────────────────────────────────────────────────
if [[ "${1:-}" == "stop" ]]; then
  echo "Stopping..."
  # Kill backgrounded processes
  for pidfile in /tmp/coding-session-dev-*.pid; do
    [ -f "$pidfile" ] && kill "$(cat "$pidfile")" 2>/dev/null && rm -f "$pidfile"
  done
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" docker compose -f "$COMPOSE_FILE" down --remove-orphans
  echo "Done."
  exit 0
fi

# ── Load .env ──────────────────────────────────────────────────────
ENV_FILE="$REPO_ROOT/packages/agents/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$ENV_FILE"
  set +a
fi

# ── Preflight ──────────────────────────────────────────────────────
echo "==> Checking prerequisites..."
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v node >/dev/null   || { echo "node not found"; exit 1; }
command -v pnpm >/dev/null   || { echo "pnpm not found"; exit 1; }

NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node ≥ 22 required (got $(node --version)). Use: asdf shell nodejs 22.12.0"
  exit 1
fi

# ── Build ──────────────────────────────────────────────────────────
echo "==> Building packages..."
pnpm --filter @electric-ax/agents-runtime build --silent
pnpm --filter @electric-ax/agents build --silent
pnpm --filter @electric-ax/agents-server build --silent

# ── Infrastructure (docker: postgres + electric only) ──────────────
# We run the agents-server from local source (see next block) so code
# changes under packages/agents-server/ take effect on the next script
# run. The "full" compose would pull electricax/agents-server:latest
# and ignore our local build.
echo "==> Starting infrastructure (postgres + electric)..."
COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT" \
  PG_HOST_PORT="$PG_PORT" \
  ELECTRIC_HOST_PORT="$ELECTRIC_PORT" \
  docker compose -f "$COMPOSE_FILE" up -d --wait postgres electric 2>&1 | tail -5

# ── Agents server (local, from source) ─────────────────────────────
echo "==> Starting agents-server from source on port $AGENTS_SERVER_PORT..."
ELECTRIC_AGENTS_DATABASE_URL="postgres://electric_agents:electric_agents@localhost:$PG_PORT/electric_agents" \
ELECTRIC_AGENTS_ELECTRIC_URL="http://localhost:$ELECTRIC_PORT" \
ELECTRIC_AGENTS_PORT="$AGENTS_SERVER_PORT" \
ELECTRIC_AGENTS_BASE_URL="$AGENTS_SERVER_URL" \
  node packages/agents-server/dist/entrypoint.js &
AGENTS_SERVER_PID=$!
echo "$AGENTS_SERVER_PID" > /tmp/coding-session-dev-agents-server.pid
echo "    PID $AGENTS_SERVER_PID"

echo "    Waiting for agents-server at $AGENTS_SERVER_URL..."
for i in $(seq 1 30); do
  if curl -sf "$AGENTS_SERVER_URL/_electric/entity-types" >/dev/null 2>&1; then
    echo "    agents-server ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "    ERROR: agents-server not reachable after 30s."
    exit 1
  fi
  sleep 1
done

# ── Built-in agents (local, foreground-able) ───────────────────────
echo "==> Starting built-in agents (horton, worker, coding-session)..."
mkdir -p "$WORK_DIR"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-dummy-for-coding-session}"

ELECTRIC_AGENTS_SERVER_URL="$AGENTS_SERVER_URL" \
ELECTRIC_AGENTS_WORKING_DIRECTORY="$WORK_DIR" \
ELECTRIC_AGENTS_BUILTIN_PORT="$BUILTIN_PORT" \
  node packages/agents/dist/entrypoint.js &
BUILTIN_PID=$!
echo "$BUILTIN_PID" > /tmp/coding-session-dev-builtin.pid
echo "    PID $BUILTIN_PID (log: this terminal)"

# Give the bootstrap a moment to register types
sleep 3

# ── Admin UI (local vite dev server) ───────────────────────────────
echo "==> Starting admin UI dev server..."
pnpm --filter @electric-ax/agents-server-ui dev --port "$UI_PORT" &
UI_PID=$!
echo "$UI_PID" > /tmp/coding-session-dev-ui.pid
echo "    PID $UI_PID"

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Everything running.                                         ║"
echo "║                                                              ║"
echo "║  Admin UI:       http://localhost:$UI_PORT                     ║"
echo "║  Agents server:  $AGENTS_SERVER_URL                          ║"
echo "║  Working dir:    $WORK_DIR                                   ║"
echo "║                                                              ║"
echo "║  Connect Admin UI to:  $AGENTS_SERVER_URL                    ║"
echo "║                                                              ║"
echo "║  Stop:  ./scripts/dev-coding-session.sh stop                 ║"
echo "║    or:  Ctrl-C (kills this terminal's children)              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# Keep this terminal alive; forward Ctrl-C to children
trap 'kill $AGENTS_SERVER_PID $BUILTIN_PID $UI_PID 2>/dev/null; rm -f /tmp/coding-session-dev-*.pid' EXIT INT TERM
wait
