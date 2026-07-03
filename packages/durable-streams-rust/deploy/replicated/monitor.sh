#!/usr/bin/env bash
# monitor.sh — sample per-node RSS/CPU + /_repl/status of a local cluster to CSV.
#
#   deploy/replicated/monitor.sh [interval_secs] > monitor.csv     (Ctrl-C to stop)
#
# Columns: ts,node,rss_mb,cpu_pct,leader,decided,log_window,pending,timeouts
# (repl columns are empty when the node is not in replicated mode)
set -euo pipefail
cd "$(dirname "$0")/../.."
INTERVAL="${1:-1}"
HTTP_BASE="${HTTP_BASE:-4437}"
STATE=".local-cluster"

echo "ts,node,rss_mb,cpu_pct,leader,decided,log_window,pending,timeouts"
while true; do
  ts="$(date +%s)"
  for f in "$STATE"/node*.pid; do
    [ -f "$f" ] || continue
    i="$(basename "$f" .pid | sed 's/node//')"
    pid="$(cat "$f")"
    read -r rss cpu <<<"$(ps -o rss=,pcpu= -p "$pid" 2>/dev/null || echo '0 0')"
    s="$(curl -sf --max-time 1 "http://127.0.0.1:$((HTTP_BASE + i - 1))/_repl/status" 2>/dev/null || true)"
    leader="$(sed -n 's/.*"leader":\([0-9null]*\).*/\1/p' <<<"$s")"
    decided="$(sed -n 's/.*"decided_idx":\([0-9]*\).*/\1/p' <<<"$s")"
    window="$(sed -n 's/.*"log_window":\([0-9]*\).*/\1/p' <<<"$s")"
    pending="$(sed -n 's/.*"pending":\([0-9]*\).*/\1/p' <<<"$s")"
    timeouts="$(sed -n 's/.*"timeouts":\([0-9]*\).*/\1/p' <<<"$s")"
    echo "$ts,$i,$((rss / 1024)),$cpu,$leader,$decided,$window,$pending,$timeouts"
  done
  sleep "$INTERVAL"
done
