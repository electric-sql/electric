#!/usr/bin/env bash
#
# Dev harness for the Electric Agents stack.
# See docs/superpowers/specs/2026-05-12-dev-script-design.md
# and docs/agents-development.md.

set -u
set -o pipefail
set -m  # enable job control so each `&` runs in its own process group

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"
DOCKER_COMPOSE_FILE="$REPO_ROOT/packages/agents-server/docker-compose.dev.yml"

# Service names managed by start/stop. Order matters only for display.
# `agents` (the built-in Horton + Worker server) is only spawned when
# `start --with-agents` is passed; otherwise the operator runs it
# manually. It is still listed here so stop/status/teardown clean up
# any pid file left behind.
SERVICES=(
  agents-runtime
  agents-server-build
  agents-build
  agents-server
  agents-server-ui
  agents
)

usage() {
  cat <<EOF
Usage: $0 <subcommand> [options]

Subcommands:
  build              Install deps and build typescript-client, agents-runtime,
                     agents-server, agents (one-shot, no watch).
  start [--detach] [--with-agents]
                     Start docker services + dev processes.
                     Foreground by default (Ctrl-C stops everything).
                     --detach        Exit after spawning; processes keep running.
                     --with-agents   Also spawn the built-in agents (Horton +
                                     Worker) after agents-server is ready.
                                     Without this, run them manually in a
                                     separate terminal.
  desktop            Run the Electron desktop app (packages/agents-desktop)
                     in the current terminal. Requires the rest of the
                     stack to already be running via 'start'.
  isolated [--no-build] [--no-agents]
                     Start a fully isolated test stack on randomly chosen
                     ports and run the Electron desktop app against it.
                     Ctrl-C stops desktop, dev processes, and docker services.
  stop               Stop all dev processes + docker compose down (volumes kept).
  teardown           Stop + docker compose down -v (wipes Postgres volume).
  status             Print which services are running.

Logs are written to .dev-logs/<name>.log.
EOF
}

log()  { printf '[dev] %s\n' "$*"; }
warn() { printf '[dev] WARN: %s\n' "$*" >&2; }
die()  { printf '[dev] ERROR: %s\n' "$*" >&2; exit 1; }

cmd_build() {
  cd "$REPO_ROOT"
  log "pnpm install"
  pnpm install || die "pnpm install failed"
  for pkg in typescript-client agents-runtime agents-mcp agents-server agents; do
    log "build packages/$pkg"
    pnpm -C "packages/$pkg" build || die "build failed for packages/$pkg"
  done
  log "build complete"
}

preflight() {
  cd "$REPO_ROOT"

  [[ -f .env ]] || die ".env not found at repo root. Create one with ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, or MOONSHOT_API_KEY."
  grep -qE '^(ANTHROPIC_API_KEY|OPENAI_API_KEY|DEEPSEEK_API_KEY|MOONSHOT_API_KEY)=' .env \
    || die ".env is missing ANTHROPIC_API_KEY, OPENAI_API_KEY, DEEPSEEK_API_KEY, or MOONSHOT_API_KEY."

  for pkg in typescript-client agents-runtime agents-mcp agents-server agents; do
    [[ -d "packages/$pkg/dist" ]] || die "packages/$pkg/dist is missing. Run: $0 build"
  done

  docker info >/dev/null 2>&1 || die "Docker daemon not reachable. Start Docker Desktop and retry."

  for name in "${SERVICES[@]}"; do
    local pidfile="$LOG_DIR/$name.pid"
    if [[ -f "$pidfile" ]]; then
      local pid
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        die "$name is already running (pid $pid). Run: $0 stop"
      else
        rm -f "$pidfile"
      fi
    fi
  done
}

spawn() {
  local name="$1"; shift
  local logfile="$LOG_DIR/$name.log"
  local pidfile="$LOG_DIR/$name.pid"
  : > "$logfile"
  (
    cd "$REPO_ROOT"
    exec "$@"
  ) >>"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  disown "$pid" 2>/dev/null || true
  log "started $name (pid $pid) -> $logfile"
}

wait_for_tcp() {
  # Poll TCP host:port until it accepts a connection or timeout (seconds) elapses.
  local host="$1" port="$2" timeout="${3:-60}" elapsed=0
  while (( elapsed < timeout )); do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3<&- 3>&-
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

wait_for_tcp_or_exit() {
  # Like wait_for_tcp, but returns 2 immediately if the named spawned process exits.
  local name="$1" host="$2" port="$3" timeout="${4:-60}" elapsed=0
  local pidfile="$LOG_DIR/$name.pid"
  while (( elapsed < timeout )); do
    if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
      exec 3<&- 3>&-
      return 0
    fi
    if [[ -f "$pidfile" ]]; then
      local pid
      pid=$(cat "$pidfile")
      if ! kill -0 "$pid" 2>/dev/null; then
        return 2
      fi
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

random_ports() {
  # Allocate N currently-free, unique localhost ports. Sockets stay open until
  # all ports are selected, which avoids duplicates within one isolated run.
  # There is still an unavoidable small race after this returns and before
  # services bind, but docker/vite/server startup will fail fast if another
  # process grabs one.
  local count="$1"
  python3 - "$count" <<'PYPORT'
import socket
import sys

count = int(sys.argv[1])
sockets = []
try:
    for _ in range(count):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        sockets.append(s)
    for s in sockets:
        print(s.getsockname()[1])
finally:
    for s in sockets:
        s.close()
PYPORT
}

compose_down_project() {
  local project="${1:-}" with_volumes="${2:-false}"
  [[ -n "$project" ]] || return 0
  cd "$REPO_ROOT"
  if [[ "$with_volumes" == "true" ]]; then
    docker compose -p "$project" -f "$DOCKER_COMPOSE_FILE" down -v       >>"$LOG_DIR/docker.log" 2>&1 || warn "docker compose down -v returned non-zero for $project"
  else
    docker compose -p "$project" -f "$DOCKER_COMPOSE_FILE" down       >>"$LOG_DIR/docker.log" 2>&1 || warn "docker compose down returned non-zero for $project"
  fi
}

ISOLATED_PROJECT=""
ISOLATED_CLEANED_UP=false

cleanup_isolated() {
  if $ISOLATED_CLEANED_UP; then
    return 0
  fi
  ISOLATED_CLEANED_UP=true
  echo
  log "shutting down isolated stack..."
  stop_processes
  compose_down_project "$ISOLATED_PROJECT" true
}

exit_isolated() {
  local exit_code="${1:-$?}"
  trap - INT TERM EXIT
  cleanup_isolated
  exit "$exit_code"
}

_signal_pg() {
  # Send signal $1 to process group of pid $2 (and to the pid itself
  # in case it isn't a group leader). Errors suppressed.
  local sig="$1" pid="$2"
  kill "-$sig" -- "-$pid" 2>/dev/null || kill "-$sig" "$pid" 2>/dev/null || true
}

stop_processes() {
  local any_alive=false
  for name in "${SERVICES[@]}"; do
    local pidfile="$LOG_DIR/$name.pid"
    [[ -f "$pidfile" ]] || continue
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      _signal_pg TERM "$pid"
      any_alive=true
    fi
  done

  if $any_alive; then
    for _ in 1 2 3 4 5; do
      local still=false
      for name in "${SERVICES[@]}"; do
        local pidfile="$LOG_DIR/$name.pid"
        [[ -f "$pidfile" ]] || continue
        local pid
        pid=$(cat "$pidfile")
        if kill -0 "$pid" 2>/dev/null; then still=true; fi
      done
      $still || break
      sleep 1
    done

    for name in "${SERVICES[@]}"; do
      local pidfile="$LOG_DIR/$name.pid"
      [[ -f "$pidfile" ]] || continue
      local pid
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        warn "$name (pid $pid) did not exit, sending SIGKILL"
        _signal_pg KILL "$pid"
      fi
      rm -f "$pidfile"
    done
  fi

  for name in "${SERVICES[@]}"; do
    rm -f "$LOG_DIR/$name.pid"
  done
}

stop_docker() {
  local with_volumes="${1:-false}"
  cd "$REPO_ROOT"
  if [[ "$with_volumes" == "true" ]]; then
    log "docker compose down -v"
    docker compose -f "$DOCKER_COMPOSE_FILE" down -v \
      >>"$LOG_DIR/docker.log" 2>&1 || warn "docker compose down returned non-zero"
  else
    log "docker compose down"
    docker compose -f "$DOCKER_COMPOSE_FILE" down \
      >>"$LOG_DIR/docker.log" 2>&1 || warn "docker compose down returned non-zero"
  fi
}

cmd_start() {
  local detach=false with_agents=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --detach)      detach=true ;;
      --with-agents) with_agents=true ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done

  preflight
  mkdir -p "$LOG_DIR"

  log "docker compose up -d"
  : > "$LOG_DIR/docker.log"
  docker compose -f "$DOCKER_COMPOSE_FILE" up -d >>"$LOG_DIR/docker.log" 2>&1 \
    || die "docker compose up failed (see $LOG_DIR/docker.log)"

  # Spawn entrypoints first so they load dist/ into memory before the
  # tsdown watchers clean+rebuild dist/. The running processes hold their
  # modules; the watchers below just keep dist/ up to date for the next
  # restart.
  spawn agents-server env \
    DATABASE_URL=postgresql://electric_agents:electric_agents@localhost:5432/electric_agents \
    ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 \
    ELECTRIC_INSECURE=true \
    node packages/agents-server/dist/entrypoint.js

  if $with_agents; then
    log "waiting for agents-server on :4437..."
    if ! wait_for_tcp 127.0.0.1 4437 60; then
      warn "agents-server did not bind :4437 within 60s (see $LOG_DIR/agents-server.log)"
      warn "starting built-in agents anyway; they may fail to register types."
    fi
    spawn agents env \
      ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \
      node packages/agents/dist/entrypoint.js
  fi

  spawn agents-runtime pnpm -C "$REPO_ROOT/packages/agents-runtime" dev
  spawn agents-server-build pnpm -C "$REPO_ROOT/packages/agents-server" dev
  spawn agents-build pnpm -C "$REPO_ROOT/packages/agents" dev
  spawn agents-server-ui pnpm -C "$REPO_ROOT/packages/agents-server-ui" dev

  cat <<EOF

  [dev] Agents stack started.
        agents-server:    http://localhost:4437
        agents-server-ui: (see $LOG_DIR/agents-server-ui.log for vite URL)
        Jaeger:           http://localhost:16686
        Logs:             $LOG_DIR/
EOF

  if $with_agents; then
    printf '        built-in agents:  http://localhost:4448\n\n'
  else
    cat <<EOF

  To run the built-in agents (Horton + Worker), wait until agents-server
  has finished startup, then in a separate terminal:

        ELECTRIC_AGENTS_SERVER_URL=http://localhost:4437 \\
          node packages/agents/dist/entrypoint.js

EOF
  fi

  if $detach; then
    log "detached; processes continue running. Use '$0 stop' to stop them."
    exit 0
  fi

  log "foreground mode — Ctrl-C to stop all services."
  trap 'echo; log "shutting down..."; stop_processes; stop_docker; exit 0' INT TERM

  # tail -F all log files; switching adds ==> file <== headers as prefix
  local tail_files=(
    "$LOG_DIR/agents-runtime.log"
    "$LOG_DIR/agents-server-build.log"
    "$LOG_DIR/agents-build.log"
    "$LOG_DIR/agents-server.log"
    "$LOG_DIR/agents-server-ui.log"
  )
  $with_agents && tail_files+=("$LOG_DIR/agents.log")
  tail -F "${tail_files[@]}"
}

cmd_isolated() {
  local do_build=true with_agents=true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-build)  do_build=false ;;
      --no-agents) with_agents=false ;;
      *) die "unknown option: $1" ;;
    esac
    shift
  done

  cd "$REPO_ROOT"
  [[ -f .env ]] || die ".env not found at repo root. Create one with ANTHROPIC_API_KEY or OPENAI_API_KEY."
  grep -qE '^(ANTHROPIC_API_KEY|OPENAI_API_KEY)=' .env     || die ".env is missing ANTHROPIC_API_KEY or OPENAI_API_KEY."
  docker info >/dev/null 2>&1 || die "Docker daemon not reachable. Start Docker Desktop and retry."

  if $do_build; then
    cmd_build
  else
    for pkg in typescript-client agents-runtime agents-mcp agents-server agents; do
      [[ -d "packages/$pkg/dist" ]] || die "packages/$pkg/dist is missing. Run without --no-build or run: $0 build"
    done
  fi

  local branch_name branch_slug run_id project
  branch_name=$(git -C "$REPO_ROOT" branch --show-current 2>/dev/null || true)
  if [[ -z "$branch_name" ]]; then
    branch_name=$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || basename "$REPO_ROOT")
  fi
  branch_slug=$(printf '%s' "$branch_name" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
  [[ -n "$branch_slug" ]] || branch_slug="worktree"
  local run_suffix
  run_suffix=$(date +%Y%m%d-%H%M%S)-$RANDOM
  run_id="iso-$branch_slug-$run_suffix"
  project="agents-$run_id"
  ISOLATED_PROJECT="$project"
  LOG_DIR="$REPO_ROOT/.dev-logs/$run_id"
  mkdir -p "$LOG_DIR"
  : > "$LOG_DIR/docker.log"

  local pg_port electric_port jaeger_ui_port jaeger_http_port jaeger_grpc_port
  local server_port agents_port ui_port desktop_ui_port
  read -r pg_port electric_port jaeger_ui_port jaeger_http_port jaeger_grpc_port \
    server_port agents_port ui_port desktop_ui_port < <(random_ports 9 | tr '\n' ' ')

  cat > "$LOG_DIR/env" <<EOF
RUN_ID=$run_id
COMPOSE_PROJECT_NAME=$project
PG_HOST_PORT=$pg_port
ELECTRIC_HOST_PORT=$electric_port
JAEGER_UI_PORT=$jaeger_ui_port
JAEGER_OTLP_HTTP_PORT=$jaeger_http_port
JAEGER_OTLP_GRPC_PORT=$jaeger_grpc_port
ELECTRIC_AGENTS_PORT=$server_port
ELECTRIC_AGENTS_BUILTIN_PORT=$agents_port
AGENTS_SERVER_UI_PORT=$ui_port
ELECTRIC_DESKTOP_UI_PORT=$desktop_ui_port
ELECTRIC_AGENTS_SERVER_URL=http://localhost:$server_port
ELECTRIC_DESKTOP_SERVER_URL=http://localhost:$server_port
ELECTRIC_AGENTS_PG_SYNC_ELECTRIC_URL=http://localhost:$electric_port/v1/shape
EOF

  log "starting isolated stack $run_id"
  log "logs: $LOG_DIR"
  log "docker compose project: $project"

  PG_HOST_PORT="$pg_port"   ELECTRIC_HOST_PORT="$electric_port"   JAEGER_UI_PORT="$jaeger_ui_port"   JAEGER_OTLP_HTTP_PORT="$jaeger_http_port"   JAEGER_OTLP_GRPC_PORT="$jaeger_grpc_port"     docker compose -p "$project" -f "$DOCKER_COMPOSE_FILE" up -d       >>"$LOG_DIR/docker.log" 2>&1 || die "docker compose up failed (see $LOG_DIR/docker.log)"

  spawn agents-server env     DATABASE_URL="postgresql://electric_agents:electric_agents@localhost:$pg_port/electric_agents"     ELECTRIC_AGENTS_ELECTRIC_URL="http://localhost:$electric_port"     ELECTRIC_AGENTS_PG_SYNC_ELECTRIC_URL="http://localhost:$electric_port/v1/shape"     ELECTRIC_AGENTS_PORT="$server_port"     ELECTRIC_AGENTS_STREAMS_DATA_DIR="$REPO_ROOT/.streams-data/$run_id"     ELECTRIC_INSECURE=true     node packages/agents-server/dist/entrypoint.js

  log "waiting for agents-server on :$server_port..."
  local wait_status=0
  wait_for_tcp_or_exit agents-server 127.0.0.1 "$server_port" 60 || wait_status=$?
  if [[ "$wait_status" == "2" ]]; then
    warn "agents-server exited before binding :$server_port"
    tail -80 "$LOG_DIR/agents-server.log" >&2 || true
    exit_isolated 1
  elif [[ "$wait_status" != "0" ]]; then
    warn "agents-server did not bind :$server_port within 60s (see $LOG_DIR/agents-server.log)"
  fi

  if $with_agents; then
    spawn agents env       ELECTRIC_AGENTS_SERVER_URL="http://localhost:$server_port"       ELECTRIC_AGENTS_BUILTIN_PORT="$agents_port"       ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID="isolated-$branch_slug"       ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER=true       ELECTRIC_AGENTS_PRINCIPAL=system:dev-local       node packages/agents/dist/entrypoint.js
  fi

  spawn agents-runtime pnpm -C "$REPO_ROOT/packages/agents-runtime" dev
  spawn agents-server-build pnpm -C "$REPO_ROOT/packages/agents-server" dev
  spawn agents-build pnpm -C "$REPO_ROOT/packages/agents" dev
  spawn agents-server-ui env     PORT="$ui_port"     ELECTRIC_AGENTS_SERVER_URL="http://localhost:$server_port"     pnpm -C "$REPO_ROOT/packages/agents-server-ui" dev -- --host 127.0.0.1 --port "$ui_port"

  cat <<EOF

  [dev] Isolated Agents stack started.
        run id:           $run_id
        agents-server:    http://localhost:$server_port
        built-in agents:  $($with_agents && printf 'http://localhost:%s' "$agents_port" || printf 'disabled')
        Electric:         http://localhost:$electric_port
        Postgres:         localhost:$pg_port
        Jaeger:           http://localhost:$jaeger_ui_port
        desktop data:     $REPO_ROOT/.desktop-data/$run_id
        logs:             $LOG_DIR
        env file:         $LOG_DIR/env

  Starting Electron desktop app. Ctrl-C stops the isolated stack.
EOF

  trap 'exit_isolated 130' INT
  trap 'exit_isolated 143' TERM
  trap 'cleanup_isolated' EXIT

  ELECTRIC_DESKTOP_USER_DATA_DIR="$REPO_ROOT/.desktop-data/$run_id"   ELECTRIC_DESKTOP_SERVER_URL="http://localhost:$server_port"   ELECTRIC_DESKTOP_PRINCIPAL=system:dev-local   ELECTRIC_DESKTOP_UI_PORT="$desktop_ui_port"   ELECTRIC_DESKTOP_DEV_SERVER_URL="http://localhost:$desktop_ui_port"     pnpm -C packages/agents-desktop dev
  local desktop_status=$?
  trap - INT TERM EXIT
  cleanup_isolated
  return "$desktop_status"
}

cmd_desktop() {
  [[ -d "$REPO_ROOT/packages/agents-desktop" ]] \
    || die "packages/agents-desktop not found"
  log "starting Electron desktop app (Ctrl-C to stop)..."
  cd "$REPO_ROOT"
  exec pnpm -C packages/agents-desktop dev
}

cmd_stop() {
  mkdir -p "$LOG_DIR"
  stop_processes
  stop_docker
  log "stopped."
}

cmd_teardown() {
  mkdir -p "$LOG_DIR"
  stop_processes
  stop_docker true
  if [[ -d "$REPO_ROOT/.streams-data" ]]; then
    log "removing .streams-data/ (durable streams local state)"
    rm -rf "$REPO_ROOT/.streams-data"
  fi
  log "torn down (volumes + local streams data removed)."
}

cmd_status() {
  printf '\nProcesses:\n'
  for name in "${SERVICES[@]}"; do
    local pidfile="$LOG_DIR/$name.pid"
    if [[ -f "$pidfile" ]]; then
      local pid
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        printf '  %-20s running (pid %s)\n' "$name" "$pid"
      else
        printf '  %-20s not running (stale pid file)\n' "$name"
      fi
    else
      printf '  %-20s not running\n' "$name"
    fi
  done

  printf '\nDocker:\n'
  if docker info >/dev/null 2>&1; then
    docker compose -f "$DOCKER_COMPOSE_FILE" ps 2>/dev/null | sed 's/^/  /'
  else
    printf '  docker daemon not reachable\n'
  fi
  echo
}

main() {
  local sub="${1-}"
  [[ -n "$sub" ]] || { usage; exit 1; }
  shift || true
  case "$sub" in
    build)    cmd_build "$@" ;;
    start)    cmd_start "$@" ;;
    desktop)  cmd_desktop "$@" ;;
    isolated) cmd_isolated "$@" ;;
    stop)     cmd_stop "$@" ;;
    teardown) cmd_teardown "$@" ;;
    status)   cmd_status "$@" ;;
    -h|--help|help) usage ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
