#!/usr/bin/env bash
# contention-repro-linux.sh — faithful Linux reproduction of the WAL write
# saturation ceiling, for the lock-contention investigation.
#
# Why Linux (vs the native macOS contention-repro.sh): on Linux the WAL fsync is
# a real `fdatasync`, and against a tmpfs data dir it is genuinely cheap (the
# Linux+NVMe regime the findings ran on) — so the per-shard LOCK / committer
# cadence becomes the bottleneck, not the drive barrier. The server and client
# run in separate containers with disjoint cpusets, so the throughput ceiling is
# not confounded by client/server CPU co-location the way the macOS box is.
#
# The server is built incrementally into a named Docker volume (fast rebuilds)
# and run from a slim glibc image; the data dir is an in-container tmpfs.
#
# Usage:
#   scripts/contention-repro-linux.sh [--shards N] [--connections C]
#       [--streams S] [--duration D] [--warmup W] [--payload P] [--batch B]
#       [--srv-cpus 0-5] [--cli-cpus 6-9] [--label NAME] [--no-build]
#       [--tmpfs SIZE] [--wal-stats 0|1]
set -euo pipefail

SHARDS=1
CONNECTIONS=256
STREAMS=20000
DURATION=20
WARMUP=5
PAYLOAD=256
BATCH=1
SRV_CPUS="0-5"
CLI_CPUS="6-9"
LABEL=""
DO_BUILD=1
TMPFS_SIZE=2g   # at high stream cardinality each non-empty file pins >=1 page: size ~ streams*4k + data
WAL_STATS=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CRATE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLIENT_CRATE="$(cd "$CRATE_DIR/../../../ds-bench/ds-bench" && pwd)"

# Distinct names per crate dir so parallel worktrees don't collide on the build
# cache / containers. A short hash of the crate path keys the per-worktree state.
KEY="$(echo "$CRATE_DIR" | cksum | cut -d' ' -f1)"
TARGET_VOL="ds-ct-target-$KEY"
CARGO_VOL="ds-ct-cargo"            # registry cache shared across worktrees (read-mostly)
NET="ds-ct-net-$KEY"
SRV="ds-ct-srv-$KEY"
CLIENT_IMG="ds-ct-client:latest"   # built once; ds-bench changes rarely

while [ $# -gt 0 ]; do
  case "$1" in
    --shards) SHARDS="$2"; shift 2;;
    --connections) CONNECTIONS="$2"; shift 2;;
    --streams) STREAMS="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --warmup) WARMUP="$2"; shift 2;;
    --payload) PAYLOAD="$2"; shift 2;;
    --batch) BATCH="$2"; shift 2;;
    --srv-cpus) SRV_CPUS="$2"; shift 2;;
    --cli-cpus) CLI_CPUS="$2"; shift 2;;
    --label) LABEL="$2"; shift 2;;
    --no-build) DO_BUILD=0; shift;;
    --tmpfs) TMPFS_SIZE="$2"; shift 2;;
    --wal-stats) WAL_STATS="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done
[ -n "$LABEL" ] || LABEL="linux-shards${SHARDS}-conn${CONNECTIONS}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/ds-ct-linux-${LABEL}.XXXXXX")"
CLIENT_JSON="$WORK/client.json"; SRV_LOG="$WORK/server.log"; CPU_LOG="$WORK/cpu.log"

cleanup() {
  [ -n "${CPU_PID:-}" ] && kill "$CPU_PID" 2>/dev/null || true
  docker rm -f "$SRV" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null

if [ "$DO_BUILD" = "1" ]; then
  echo "== building server (incremental, volume $TARGET_VOL) ==" >&2
  docker run --rm \
    -v "$CRATE_DIR":/app:ro \
    -v "$TARGET_VOL":/target \
    -v "$CARGO_VOL":/usr/local/cargo/registry \
    -w /app rust:1-bookworm \
    cargo build --release --locked --target-dir /target >&2
  echo "== building client image (cached) ==" >&2
  docker build -q -t "$CLIENT_IMG" -f "$CLIENT_CRATE/../dockerfiles/ds-bench.Dockerfile" "$CLIENT_CRATE" >&2
fi

echo "== run: $LABEL  shards=$SHARDS conn=$CONNECTIONS streams=$STREAMS srv_cpus=$SRV_CPUS cli_cpus=$CLI_CPUS ==" >&2
docker rm -f "$SRV" >/dev/null 2>&1 || true
# Run the freshly-built glibc binary from the target volume in a slim glibc image
# (bookworm → bookworm, ABI-compatible). Data dir is an in-container tmpfs.
docker run -d --name "$SRV" --network "$NET" \
  --cpuset-cpus="$SRV_CPUS" \
  -v "$TARGET_VOL":/target:ro \
  --tmpfs /data:rw,size="$TMPFS_SIZE" \
  debian:bookworm-slim \
  /target/release/durable-streams-server \
    --host 0.0.0.0 --port 4437 --data-dir /data \
    --durability wal --wal-shards "$SHARDS" --wal-stats "$WAL_STATS" >/dev/null

for _ in $(seq 1 100); do
  docker logs "$SRV" 2>&1 | grep -q "listening on" && break
  docker ps -q --filter "name=$SRV" | grep -q . || { echo "server died:" >&2; docker logs "$SRV" >&2; exit 1; }
  sleep 0.1
done

( while docker ps -q --filter "name=$SRV" | grep -q .; do
    docker stats --no-stream --format '{{.CPUPerc}}' "$SRV" 2>/dev/null | tr -d '%' >> "$CPU_LOG" || true
  done ) &
CPU_PID=$!

docker run --rm --network "$NET" --cpuset-cpus="$CLI_CPUS" "$CLIENT_IMG" \
  multi-stream --target "http://$SRV:4437" --api-style durable \
  --streams "$STREAMS" --connections "$CONNECTIONS" --batch "$BATCH" \
  --payload-bytes "$PAYLOAD" --warmup-secs "$WARMUP" --duration-secs "$DURATION" \
  --setup-concurrency 256 >"$CLIENT_JSON" 2>>"$SRV_LOG" || { echo "client failed" >&2; tail -20 "$SRV_LOG" >&2; exit 1; }

kill "$CPU_PID" 2>/dev/null || true
docker logs "$SRV" >>"$SRV_LOG" 2>&1 || true

python3 - "$CLIENT_JSON" "$SRV_LOG" "$CPU_LOG" "$LABEL" "$WARMUP" <<'PY'
import json, sys, re
client_json, srv_log, cpu_log, label, warmup = sys.argv[1:6]; warmup=int(warmup)
c=json.load(open(client_json))
ops=c.get("aggregate_ops_per_sec",0.0); lat=c.get("latency_ms",{}) or {}
p50=lat.get("p50_ms",0.0); p99=lat.get("p99_ms",0.0)
errs=sum(e.get("count",0) for e in (c.get("errors") or []))
pat=re.compile(r"([\w/]+)=([-+0-9.eE]+)"); rows=[]
for line in open(srv_log,errors="ignore"):
    if "WAL_CONT" in line:
        d={k:float(v) for k,v in pat.findall(line)}
        if d: rows.append(d)
steady=rows[warmup:] if len(rows)>warmup else rows
avg=lambda k:(sum(r[k] for r in steady if k in r)/len([r for r in steady if k in r])) if any(k in r for r in steady) else 0.0
cpu=[float(x) for x in open(cpu_log).read().split() if x] if __import__("os").path.exists(cpu_log) else []
cpu_steady=cpu[warmup:] if len(cpu)>warmup else cpu
cpu_avg=sum(cpu_steady)/len(cpu_steady) if cpu_steady else 0.0
print(f"RESULT label={label}")
print(f"  throughput_ops_s   = {ops:,.0f}")
print(f"  latency_ms p50/p99 = {p50:.1f} / {p99:.1f}")
print(f"  errors             = {errs}")
print(f"  server_cpu_pct     = {cpu_avg:.0f}   (Docker %CPU; 600 = 6 full cores)")
print(f"  fsync_per_s        = {avg('fsync/s'):,.0f}   batch_avg = {avg('batch_avg'):.1f}")
print(f"  inner_wait_us      = {avg('inner_wait_us'):.2f}   inner_wait_load = {avg('inner_wait_load'):.2f} cores")
print(f"  dirty_wait_us      = {avg('dirty_wait_us'):.2f}   dirty_wait_load = {avg('dirty_wait_load'):.2f} cores")
print(f"  waiters_woken_avg  = {avg('waiters_woken_avg'):.1f}")
ck=[{k:float(v) for k,v in pat.findall(l)} for l in open(srv_log,errors="ignore") if "WAL_CKPT" in l]
if ck:
    n=len(ck)
    m=lambda k:max(r.get(k,0.0) for r in ck)
    a=lambda k:sum(r.get(k,0.0) for r in ck)/n
    print(f"  ckpt (n={n}) touched avg/max      = {a('touched'):,.0f} / {m('touched'):,.0f}   tails_entries max = {m('tails_entries'):,.0f}   meta avg = {a('meta'):,.0f}")
    print(f"  ckpt us avg/max: capture={a('capture_us'):,.0f}/{m('capture_us'):,.0f} fsync={a('fsync_us'):,.0f}/{m('fsync_us'):,.0f} tails={a('tails_us'):,.0f}/{m('tails_us'):,.0f} rest={a('rest_us'):,.0f}/{m('rest_us'):,.0f} meta={a('meta_us'):,.0f}/{m('meta_us'):,.0f} total={a('total_us'):,.0f}/{m('total_us'):,.0f}")
PY
