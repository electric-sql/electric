#!/usr/bin/env bash
# local-cluster.sh — run a 3-node replicated durable-streams cluster locally.
#
#   deploy/replicated/local-cluster.sh up       build + start nodes 1..3
#   deploy/replicated/local-cluster.sh status   per-node /_repl/status
#   deploy/replicated/local-cluster.sh down     stop and clean up
#
# Ports: HTTP 4437/4438/4439, replication mesh 5437/5438/5439 (loopback only).
# State: ./.local-cluster/{node<i>/data,node<i>.log,node<i>.pid}
# Env:   NODES=3   HTTP_BASE=4437   REPL_BASE=5437   PROFILE=release
#        MODE=replicated|memory|wal  (memory/wal: single-node baseline, no mesh)
#        REPL_STATS_SECS=5  SNAPSHOT_LOGS=5000  EXTRA_ARGS="..."
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${MODE:-replicated}"
NODES="${NODES:-3}"
[ "$MODE" = replicated ] || NODES=1
HTTP_BASE="${HTTP_BASE:-4437}"
REPL_BASE="${REPL_BASE:-5437}"
PROFILE="${PROFILE:-release}"
REPL_STATS_SECS="${REPL_STATS_SECS:-5}"
SNAPSHOT_LOGS="${SNAPSHOT_LOGS:-5000}"
STATE=".local-cluster"

peers() {
  local out=""
  for i in $(seq 1 "$NODES"); do
    out+="${out:+,}${i}@127.0.0.1:$((REPL_BASE + i - 1))"
  done
  echo "$out"
}

up() {
  if [ "$PROFILE" = release ]; then
    cargo build --release
    BIN=target/release/durable-streams-server
  else
    cargo build
    BIN=target/debug/durable-streams-server
  fi
  mkdir -p "$STATE"
  for i in $(seq 1 "$NODES"); do
    local http=$((HTTP_BASE + i - 1)) repl=$((REPL_BASE + i - 1))
    local data="$STATE/node$i/data"
    mkdir -p "$data"
    local mode_args=()
    if [ "$MODE" = replicated ]; then
      mode_args=(
        --durability replicated
        --repl-id "$i"
        --repl-peers "$(peers)"
        --repl-listen "127.0.0.1:$repl"
        --repl-snapshot-logs "$SNAPSHOT_LOGS"
      )
      [ "$REPL_STATS_SECS" != 0 ] && mode_args+=(--repl-stats "$REPL_STATS_SECS")
    else
      mode_args=(--durability "$MODE")
    fi
    # shellcheck disable=SC2086
    "$BIN" \
      --host 127.0.0.1 --port "$http" \
      --data-dir "$data" \
      "${mode_args[@]}" ${EXTRA_ARGS:-} \
      >"$STATE/node$i.log" 2>&1 &
    echo $! >"$STATE/node$i.pid"
    echo "node $i: http://127.0.0.1:$http  ($MODE, pid $!)"
  done
  if [ "$MODE" != replicated ]; then
    sleep 0.3
    curl -sf "http://127.0.0.1:$HTTP_BASE/health" >/dev/null && echo "single-node $MODE server up"
    return 0
  fi
  # Wait for a leader (election timeout is ~500 ms).
  for _ in $(seq 1 50); do
    leader="$(curl -sf "http://127.0.0.1:$HTTP_BASE/_repl/status" 2>/dev/null \
      | sed -n 's/.*"leader":\([0-9null]*\).*/\1/p')" || true
    if [ -n "${leader:-}" ] && [ "$leader" != null ]; then
      echo "cluster up — leader is node $leader"
      return 0
    fi
    sleep 0.2
  done
  echo "WARNING: no leader observed yet; check $STATE/node*.log" >&2
  return 1
}

status() {
  for i in $(seq 1 "$NODES"); do
    local http=$((HTTP_BASE + i - 1))
    printf 'node %s: ' "$i"
    curl -sf "http://127.0.0.1:$http/_repl/status" || printf 'DOWN'
    echo
  done
}

down() {
  for f in "$STATE"/node*.pid; do
    [ -f "$f" ] || continue
    kill "$(cat "$f")" 2>/dev/null || true
    rm -f "$f"
  done
  rm -rf "$STATE"
  echo "cluster down"
}

# Restart one node in place (same data dir: streams are wiped at boot and
# resynced from the cluster; the durable vote file is what makes the rejoin
# election-safe). Usage: local-cluster.sh restart <i>
restart_node() {
  local i="$1"
  [ "$MODE" = replicated ] || { echo "restart is for MODE=replicated" >&2; exit 2; }
  local http=$((HTTP_BASE + i - 1)) repl=$((REPL_BASE + i - 1))
  local data="$STATE/node$i/data"
  [ -d "$data" ] || { echo "node $i has no state dir" >&2; exit 2; }
  if [ -f "$STATE/node$i.pid" ]; then
    kill "$(cat "$STATE/node$i.pid")" 2>/dev/null || true
    sleep 0.3
  fi
  BIN=target/release/durable-streams-server
  [ "$PROFILE" = release ] || BIN=target/debug/durable-streams-server
  local mode_args=(
    --durability replicated
    --repl-id "$i"
    --repl-peers "$(peers)"
    --repl-listen "127.0.0.1:$repl"
    --repl-snapshot-logs "$SNAPSHOT_LOGS"
  )
  [ "$REPL_STATS_SECS" != 0 ] && mode_args+=(--repl-stats "$REPL_STATS_SECS")
  # shellcheck disable=SC2086
  "$BIN" \
    --host 127.0.0.1 --port "$http" \
    --data-dir "$data" \
    "${mode_args[@]}" ${EXTRA_ARGS:-} \
    >>"$STATE/node$i.log" 2>&1 &
  echo $! >"$STATE/node$i.pid"
  echo "node $i restarted (pid $!)"
}

case "${1:-}" in
  up) up ;;
  status) status ;;
  down) down ;;
  restart) restart_node "${2:?usage: $0 restart <i>}" ;;
  *) echo "usage: $0 {up|status|down|restart <i>}" >&2; exit 2 ;;
esac
