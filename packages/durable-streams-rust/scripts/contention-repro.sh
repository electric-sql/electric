#!/usr/bin/env bash
# contention-repro.sh — drive the durable WAL server with the ds-bench pool
# client and report write throughput ALONGSIDE the per-shard lock-contention
# rates (the `WAL_CONT` stderr lines from `--wal-stats`). This is the local
# reproduction harness for the write-saturation contention study: it makes the
# per-shard `inner`/`dirty` lock-wait and the durability wakeup fan-out visible
# next to ops/s, so a candidate architecture change can be judged on whether it
# lifts throughput AND drops the contention it was supposed to.
#
# It runs the server and the load generator on the SAME box (fine for surfacing
# LOCK contention — the locks serialize regardless of where the load comes from;
# absolute ops/s is lower than a split client/server, but the contention signal
# and its before/after delta are what matter here).
#
# Usage:
#   scripts/contention-repro.sh [--shards N] [--connections C] [--streams S]
#       [--duration D] [--warmup W] [--payload P] [--batch B] [--port PORT]
#       [--label NAME] [--server BIN] [--client BIN] [--keep-logs]
#
# Example — force single-shard contention, then the cores-many-shard baseline:
#   scripts/contention-repro.sh --shards 1  --connections 256 --label shards1
#   scripts/contention-repro.sh --shards 10 --connections 256 --label shards10
set -euo pipefail

# ---- defaults -------------------------------------------------------------
SHARDS=1
CONNECTIONS=256
STREAMS=20000
DURATION=20
WARMUP=5
PAYLOAD=256
BATCH=1
PORT=4500
LABEL=""
KEEP_LOGS=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_BIN="$CRATE_DIR/target/release/durable-streams-server"
# The ds-bench load generator. Default to the sibling ds-bench checkout.
CLIENT_BIN="$CRATE_DIR/../../../ds-bench/ds-bench/target/release/ds-bench"

while [ $# -gt 0 ]; do
  case "$1" in
    --shards) SHARDS="$2"; shift 2;;
    --connections) CONNECTIONS="$2"; shift 2;;
    --streams) STREAMS="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --warmup) WARMUP="$2"; shift 2;;
    --payload) PAYLOAD="$2"; shift 2;;
    --batch) BATCH="$2"; shift 2;;
    --port) PORT="$2"; shift 2;;
    --label) LABEL="$2"; shift 2;;
    --server) SERVER_BIN="$2"; shift 2;;
    --client) CLIENT_BIN="$2"; shift 2;;
    --keep-logs) KEEP_LOGS=1; shift;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

[ -x "$SERVER_BIN" ] || { echo "server binary not found/executable: $SERVER_BIN (run: cargo build --release)" >&2; exit 2; }
[ -x "$CLIENT_BIN" ] || { echo "client binary not found/executable: $CLIENT_BIN (build ds-bench: cargo build --release)" >&2; exit 2; }

[ -n "$LABEL" ] || LABEL="shards${SHARDS}-conn${CONNECTIONS}-streams${STREAMS}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ds-contention-${LABEL}.XXXXXX")"
DATA_DIR="$WORK/data"
SRV_LOG="$WORK/server.log"
CLIENT_JSON="$WORK/client.json"
CPU_LOG="$WORK/cpu.log"
mkdir -p "$DATA_DIR"

cleanup() {
  [ -n "${CPU_PID:-}" ] && kill "$CPU_PID" 2>/dev/null || true
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  if [ "$KEEP_LOGS" = "1" ]; then
    echo "logs kept in: $WORK" >&2
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT INT TERM

echo "== contention-repro: $LABEL ==" >&2
echo "   shards=$SHARDS connections=$CONNECTIONS streams=$STREAMS batch=$BATCH payload=$PAYLOAD duration=${DURATION}s warmup=${WARMUP}s" >&2

# ---- launch the server (--wal-stats 1 → one WAL_CONT line/sec on stderr) ---
# DS_BENCH_FAST_FSYNC: on macOS, use plain fsync instead of F_FULLFSYNC so the
# RAM-disk data dir gives cheap fsync (the Linux+NVMe regime) and the per-shard
# LOCK becomes the bottleneck instead of the drive barrier. Bench-only; honoured
# from the caller's env, defaulting on for this harness.
DS_BENCH_FAST_FSYNC="${DS_BENCH_FAST_FSYNC:-1}" \
"$SERVER_BIN" \
  --host 127.0.0.1 --port "$PORT" \
  --data-dir "$DATA_DIR" \
  --durability wal \
  --wal-shards "$SHARDS" \
  --wal-stats 1 \
  >/dev/null 2>"$SRV_LOG" &
SRV_PID=$!

# wait for "listening" (≤10s)
for _ in $(seq 1 100); do
  grep -q "listening on" "$SRV_LOG" 2>/dev/null && break
  kill -0 "$SRV_PID" 2>/dev/null || { echo "server died at startup:" >&2; cat "$SRV_LOG" >&2; exit 1; }
  sleep 0.1
done

# ---- sample server CPU (%) once/sec while the client runs -----------------
( while kill -0 "$SRV_PID" 2>/dev/null; do
    ps -o %cpu= -p "$SRV_PID" 2>/dev/null | tr -d ' ' >> "$CPU_LOG" || true
    sleep 1
  done ) &
CPU_PID=$!

# ---- drive the load ------------------------------------------------------
"$CLIENT_BIN" multi-stream \
  --target "http://127.0.0.1:$PORT" \
  --api-style durable \
  --streams "$STREAMS" \
  --connections "$CONNECTIONS" \
  --batch "$BATCH" \
  --payload-bytes "$PAYLOAD" \
  --warmup-secs "$WARMUP" \
  --duration-secs "$DURATION" \
  --setup-concurrency 256 \
  >"$CLIENT_JSON" 2>>"$SRV_LOG" || { echo "client failed:" >&2; tail -20 "$SRV_LOG" >&2; exit 1; }

kill "$CPU_PID" 2>/dev/null || true

# ---- summarize (python3: parse client JSON + steady-state WAL_CONT + CPU) -
python3 - "$CLIENT_JSON" "$SRV_LOG" "$CPU_LOG" "$LABEL" "$WARMUP" <<'PY'
import json, sys, re
client_json, srv_log, cpu_log, label, warmup = sys.argv[1:6]
warmup = int(warmup)

with open(client_json) as f:
    c = json.load(f)
ops = c.get("aggregate_ops_per_sec", 0.0)
lat = c.get("latency_ms", {}) or {}
p50 = lat.get("p50_ms", lat.get("p50", 0.0))
p99 = lat.get("p99_ms", lat.get("p99", 0.0))
errs = sum(e.get("count", 0) for e in (c.get("errors") or []))

# WAL_CONT steady-state: drop the first `warmup` lines (warmup window), average.
pat = re.compile(r"([\w/]+)=([-+0-9.eE]+)")
rows = []
with open(srv_log, errors="ignore") as f:
    for line in f:
        if "WAL_CONT" not in line:
            continue
        d = {k: float(v) for k, v in pat.findall(line)}
        if d:
            rows.append(d)
steady = rows[warmup:] if len(rows) > warmup else rows
def avg(key):
    vals = [r[key] for r in steady if key in r]
    return sum(vals) / len(vals) if vals else 0.0

# CPU: drop the first `warmup` samples, average; macOS %cpu is per-core summed
# (can exceed 100% on multi-core).
cpu_vals = []
try:
    with open(cpu_log) as f:
        for line in f:
            line = line.strip()
            if line:
                try: cpu_vals.append(float(line))
                except ValueError: pass
except FileNotFoundError:
    pass
cpu_steady = cpu_vals[warmup:] if len(cpu_vals) > warmup else cpu_vals
cpu_avg = sum(cpu_steady) / len(cpu_steady) if cpu_steady else 0.0

print(f"RESULT label={label}")
print(f"  throughput_ops_s   = {ops:,.0f}")
print(f"  latency_ms p50/p99 = {p50:.1f} / {p99:.1f}")
print(f"  errors             = {errs}")
print(f"  server_cpu_pct      = {cpu_avg:.0f}   (summed across cores; 1000 = 10 full cores)")
print(f"  staged_per_s       = {avg('staged/s'):,.0f}")
print(f"  fsync_per_s        = {avg('fsync/s'):,.0f}   batch_avg = {avg('batch_avg'):.1f}")
print(f"  inner_wait_us      = {avg('inner_wait_us'):.2f}   inner_wait_load = {avg('inner_wait_load'):.2f} cores")
print(f"  dirty_wait_us      = {avg('dirty_wait_us'):.2f}   dirty_wait_load = {avg('dirty_wait_load'):.2f} cores")
print(f"  waiters_woken_avg  = {avg('waiters_woken_avg'):.1f}")
PY
