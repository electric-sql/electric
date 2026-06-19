#!/usr/bin/env bash
# Local regression harness (macOS dev box) for the live-file compaction work.
#
# These are RELATIVE numbers — client (oha) and server share the same cores,
# there is no cgroup pinning, so absolutes differ from the Hetzner BENCHMARKS.md
# runs. The point is baseline-vs-change on the SAME machine: detect regression.
#
# Usage:  ./.bench-local.sh <label>        # e.g. baseline | compaction
# Output: /tmp/ds-bench/results-<label>.json  (+ a human summary on stdout)
#
# Scenarios (the paths compaction touches):
#   read1k       1 KB cached catch-up GET, no tier      (read hot path — must NOT change)
#   read1m       1 MB resident GET, no tier             (sendfile large-read path)
#   append100    100 B POST, no tier                    (group-commit append path)
#   append_tier  100 B POST, --tier local, 1 MiB segs   (THE compaction path: sealing active)
#                also records live-file + data-dir bytes after the run.
set -u

LABEL="${1:?usage: .bench-local.sh <label>}"
BIN="${BIN:-/tmp/ds-bench-target/release/durable-streams-server}"
PORT="${PORT:-4711}"
URL="http://127.0.0.1:${PORT}/s"
CONN_READ="${CONN_READ:-64}"
CONN_APPEND="${CONN_APPEND:-64}"
DUR="${DUR:-10s}"
REPEATS="${REPEATS:-3}"
ROOT=/tmp/ds-bench
OUT="$ROOT/results-${LABEL}.json"
mkdir -p "$ROOT"
[ -x "$BIN" ] || { echo "missing binary: $BIN"; exit 1; }

SRV=""
stop_server() { [ -n "$SRV" ] && kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""; }
trap 'stop_server' EXIT

start_server() {  # extra args passed through
  local data="$1"; shift
  rm -rf "$data"; mkdir -p "$data"
  "$BIN" --host 127.0.0.1 --port "$PORT" --data-dir "$data" "$@" \
    >"$ROOT/server-${LABEL}.log" 2>&1 &
  SRV=$!
  local i
  for i in $(seq 1 100); do
    curl -fsS -X PUT "$URL" -H 'Content-Type: application/octet-stream' >/dev/null 2>&1 && return 0
    sleep 0.1
  done
  echo "server did not become ready"; cat "$ROOT/server-${LABEL}.log"; exit 1
}

# cumulative CPU seconds of the server process (macOS ps TIME = [hh:]mm:ss[.ss])
cpu_secs() {
  local t; t=$(ps -p "$SRV" -o time= 2>/dev/null | tr -d ' ')
  [ -z "$t" ] && { echo 0; return; }
  awk -F: '{ s=0; for(i=1;i<=NF;i++) s=s*60+$i; printf "%.2f", s }' <<<"$t"
}

# median of stdin numbers
median() { sort -n | awk '{a[NR]=$1} END{ if(NR%2){print a[(NR+1)/2]} else {print (a[NR/2]+a[NR/2+1])/2} }'; }

seed_bytes() {  # $1 = byte count, written to the stream as one POST
  head -c "$1" /dev/zero | tr '\0' 'x' > "$ROOT/body.bin"
  curl -fsS -X POST "$URL" -H 'Content-Type: application/octet-stream' --data-binary @"$ROOT/body.bin" >/dev/null
  local got; got=$(curl -fsS "$URL" | wc -c | tr -d ' ')
  [ "$got" = "$1" ] || { echo "seed mismatch: wanted $1 got $got"; exit 1; }
}

# run oha once, echo "rps p50ms p99ms success cpu%"
run_oha() {  # $1 method, $2 conn, $3 bodyfile-or-empty
  local method="$1" conn="$2" body="$3"
  local c0 c1 j args=( -z "$DUR" -c "$conn" --no-tui --output-format json -m "$method" )
  [ -n "$body" ] && args+=( -D "$body" -T application/octet-stream )
  c0=$(cpu_secs)
  oha "${args[@]}" "$URL" > "$ROOT/oha.json" 2>/dev/null
  c1=$(cpu_secs)
  local secs; secs=$(awk -v d="$DUR" 'BEGIN{gsub(/s/,"",d); print d}')
  jq -r --arg c0 "$c0" --arg c1 "$c1" --arg secs "$secs" '
    .summary.requestsPerSec as $r | .summary.successRate as $sr |
    (.latencyPercentiles.p50*1000) as $p50 | (.latencyPercentiles.p99*1000) as $p99 |
    (((($c1|tonumber)-($c0|tonumber))/($secs|tonumber))*100) as $cpu |
    "\($r) \($p50) \($p99) \($sr) \($cpu)"' "$ROOT/oha.json"
}

# scenario: collect REPEATS runs, emit a JSON object for the results file
scenario() {  # $1 name, $2 method, $3 conn, $4 bodyfile-or-empty
  local name="$1" method="$2" conn="$3" body="$4"
  local rps=() p50=() p99=() cpu=() sr_min=100 i line
  echo "  -- $name (m=$method c=$conn x$REPEATS) --" >&2
  for i in $(seq 1 "$REPEATS"); do
    line=$(run_oha "$method" "$conn" "$body")
    read -r r p5 p9 sr cp <<<"$line"
    rps+=("$r"); p50+=("$p5"); p99+=("$p9"); cpu+=("$cp")
    awk -v a="$sr" -v b="$sr_min" 'BEGIN{exit !(a<b)}' && sr_min="$sr"
    printf "     run %d: %8.0f rps  p50=%.3fms p99=%.3fms  cpu=%.0f%%  ok=%s\n" \
      "$i" "$r" "$p5" "$p9" "$cp" "$sr" >&2
  done
  local mr mp5 mp9 mc
  mr=$(printf '%s\n' "${rps[@]}" | median)
  mp5=$(printf '%s\n' "${p50[@]}" | median)
  mp9=$(printf '%s\n' "${p99[@]}" | median)
  mc=$(printf '%s\n' "${cpu[@]}" | median)
  printf "     MEDIAN: %8.0f rps  p50=%.3fms p99=%.3fms cpu=%.0f%%\n" "$mr" "$mp5" "$mp9" "$mc" >&2
  jq -n --arg n "$name" --argjson rps "$mr" --argjson p50 "$mp5" \
        --argjson p99 "$mp9" --argjson cpu "$mc" --argjson srmin "$sr_min" \
    '{name:$n, rps_median:$rps, p50ms_median:$p50, p99ms_median:$p99, cpu_pct_median:$cpu, success_min:$srmin}'
}

echo "### bench label=$LABEL  bin=$BIN  conn(r/a)=$CONN_READ/$CONN_APPEND dur=$DUR x$REPEATS" >&2
RESULTS=()

# 1) read1k — no tier
start_server "$ROOT/data" ; seed_bytes 1024
RESULTS+=("$(scenario read1k GET "$CONN_READ" "")")
stop_server

# 2) read1m — no tier
start_server "$ROOT/data" ; seed_bytes 1048576
RESULTS+=("$(scenario read1m GET 32 "")")
stop_server

# 3) append100 — no tier
head -c 100 /dev/zero | tr '\0' 'x' > "$ROOT/append100.bin"
start_server "$ROOT/data"
RESULTS+=("$(scenario append100 POST "$CONN_APPEND" "$ROOT/append100.bin")")
stop_server

# 4) append_tier — tier local, small segments so sealing (and future compaction) is active
DATA_T="$ROOT/data-tier"; COLD_T="$ROOT/cold-tier"; rm -rf "$COLD_T"; mkdir -p "$COLD_T"
start_server "$DATA_T" --tier local --tier-local-dir "$COLD_T" --tier-segment-bytes 1048576
RESULTS+=("$(scenario append_tier POST "$CONN_APPEND" "$ROOT/append100.bin")")
# let any pending seal/offload settle, then measure on-disk footprint
sleep 2
LIVE_FILE=$(find "$DATA_T/streams" -type f ! -name '*.meta' -print0 2>/dev/null | xargs -0 ls -S 2>/dev/null | head -1)
LIVE_BYTES=$( [ -n "$LIVE_FILE" ] && stat -f%z "$LIVE_FILE" 2>/dev/null || echo 0 )
DATA_KB=$(du -sk "$DATA_T" 2>/dev/null | awk '{print $1}')
COLD_KB=$(du -sk "$COLD_T" 2>/dev/null | awk '{print $1}')
TAIL_OFF=$(curl -fsS -D - -o /dev/null "$URL" 2>/dev/null | awk 'BEGIN{IGNORECASE=1}/stream-tail|content-range|stream-offset/{print}')
stop_server
echo "     append_tier footprint: live_file=${LIVE_BYTES}B  data_dir=${DATA_KB}KB  cold_dir=${COLD_KB}KB" >&2

DISK=$(jq -n --argjson live "$LIVE_BYTES" --argjson data "$DATA_KB" --argjson cold "$COLD_KB" \
  '{live_file_bytes:$live, data_dir_kb:$data, cold_dir_kb:$cold}')

# assemble results file
printf '%s\n' "${RESULTS[@]}" | jq -s --arg label "$LABEL" --argjson disk "$DISK" \
  '{label:$label, scenarios:., append_tier_disk:$disk}' > "$OUT"
echo "### wrote $OUT" >&2
jq . "$OUT"
