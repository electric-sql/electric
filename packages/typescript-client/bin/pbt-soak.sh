#!/usr/bin/env bash
#
# Long-running property-based test soak for the ShapeStream client.
# Runs the model-based PBT in a loop with fast-check generating a new
# random seed on each iteration. Stops on the first failure, dumps the
# failing seed + counterexample to stdout and to a log file for triage.
#
# Usage:
#   bin/pbt-soak.sh               # 1-hour soak with defaults
#   SOAK_BUDGET_SEC=3600 \
#   PBT_NUM_RUNS=500 \
#   PBT_MAX_COMMANDS=120 \
#     bin/pbt-soak.sh

set -u

cd "$(dirname "$0")/.."

: "${SOAK_BUDGET_SEC:=3600}"   # total soak budget: 1 hour by default
: "${PBT_NUM_RUNS:=500}"        # fast-check runs per iteration
: "${PBT_MAX_COMMANDS:=120}"    # max generated commands per run
: "${PBT_TIMEOUT_MS:=1800000}"  # vitest timeout: 30 min

LOG_DIR="pbt-soak-logs"
mkdir -p "$LOG_DIR"

STARTED_AT=$(date +%s)
ITER=0
TOTAL_RUNS=0

echo "────────────────────────────────────────────────────────────"
echo "PBT soak starting"
echo "  budget:         ${SOAK_BUDGET_SEC}s"
echo "  runs per iter:  ${PBT_NUM_RUNS}"
echo "  max commands:   ${PBT_MAX_COMMANDS}"
echo "  log dir:        ${LOG_DIR}/"
echo "  started at:     $(date -Iseconds)"
echo "────────────────────────────────────────────────────────────"

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - STARTED_AT))
  REMAINING=$((SOAK_BUDGET_SEC - ELAPSED))
  if [ "$REMAINING" -le 0 ]; then
    echo ""
    echo "────────────────────────────────────────────────────────────"
    echo "Soak budget exhausted. ${ITER} iterations, ${TOTAL_RUNS} runs total."
    echo "No failures detected."
    echo "────────────────────────────────────────────────────────────"
    exit 0
  fi

  ITER=$((ITER + 1))
  LOG_FILE="${LOG_DIR}/iter-$(printf '%04d' "$ITER").log"

  printf "[iter %4d | elapsed %5ds | remaining %5ds] runs=%d cmds=%d … " \
    "$ITER" "$ELAPSED" "$REMAINING" "$PBT_NUM_RUNS" "$PBT_MAX_COMMANDS"

  PBT_NUM_RUNS="$PBT_NUM_RUNS" \
  PBT_MAX_COMMANDS="$PBT_MAX_COMMANDS" \
  PBT_TIMEOUT_MS="$PBT_TIMEOUT_MS" \
    pnpm exec vitest run --config vitest.pbt.config.ts \
      > "$LOG_FILE" 2>&1
  STATUS=$?

  TOTAL_RUNS=$((TOTAL_RUNS + PBT_NUM_RUNS))

  if [ "$STATUS" -eq 0 ]; then
    echo "pass"
    # keep only the last successful log to save space
    rm -f "$LOG_FILE"
  else
    echo "FAIL (exit $STATUS)"
    echo ""
    echo "────────────────────────────────────────────────────────────"
    echo "SOAK FAILED on iteration ${ITER} after ${ELAPSED}s."
    echo "Log saved to: ${LOG_FILE}"
    echo "────────────────────────────────────────────────────────────"
    echo ""
    # Surface the failing seed/path/counterexample so the operator can
    # reproduce with PBT_SEED=<n> PBT_PATH=<p>
    grep -E "seed:|Counterexample|Property failed|shrunk|AssertionError|Error:" \
      "$LOG_FILE" | head -80 || true
    echo ""
    echo "Full log: ${LOG_FILE}"
    exit "$STATUS"
  fi
done
