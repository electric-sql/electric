#!/usr/bin/env bash
# smoke.sh — end-to-end check of a replicated cluster, including leader fail-over.
#
# Boots a local 3-node cluster (via local-cluster.sh), then:
#   1. PUT a stream on node 1
#   2. POST appends on nodes 2 and 3 (any node accepts writes)
#   3. GET from every node — byte-identical
#   4. kill the LEADER, append again on a survivor (fail-over), read it back
#
# Exits non-zero on the first failed expectation. Cleans up on exit.
set -euo pipefail
cd "$(dirname "$0")"

HTTP_BASE="${HTTP_BASE:-4437}"
STREAM="/smoke-$$"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "  ok: $*"; }

cleanup() { ./local-cluster.sh down >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== booting 3-node cluster"
./local-cluster.sh up

url() { echo "http://127.0.0.1:$((HTTP_BASE + $1 - 1))$2"; }

echo "== create + append via different nodes"
code="$(curl -s -o /dev/null -w '%{http_code}' -X PUT \
  -H 'content-type: application/octet-stream' "$(url 1 "$STREAM")")"
[ "$code" = 201 ] || fail "PUT on node 1 → $code (want 201)"
pass "PUT on node 1 → 201"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'content-type: application/octet-stream' --data-binary 'hello ' "$(url 2 "$STREAM")")"
[ "$code" = 204 ] || fail "POST on node 2 → $code (want 204)"
pass "POST on node 2 (follower or leader — both accept) → 204"

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H 'content-type: application/octet-stream' --data-binary 'world' "$(url 3 "$STREAM")")"
[ "$code" = 204 ] || fail "POST on node 3 → $code (want 204)"
pass "POST on node 3 → 204"

echo "== every node serves identical bytes"
for i in 1 2 3; do
  # Followers apply decided entries asynchronously — poll briefly.
  for _ in $(seq 1 50); do
    body="$(curl -sf "$(url "$i" "$STREAM")")" || body=""
    [ "$body" = "hello world" ] && break
    sleep 0.1
  done
  [ "$body" = "hello world" ] || fail "node $i read: $(printf %q "$body")"
  pass "node $i reads 'hello world'"
done

echo "== leader fail-over"
leader="$(curl -sf "$(url 1 /_repl/status)" | sed -n 's/.*"leader":\([0-9]*\).*/\1/p')"
[ -n "$leader" ] || fail "no leader in /_repl/status"
kill "$(cat ../../.local-cluster/node"$leader".pid)" # state dir lives at the crate root
pass "killed leader (node $leader)"
survivor=$(( leader == 1 ? 2 : 1 ))

# Appends stall until re-election (~500 ms); retry until the survivor acks.
ok=""
for _ in $(seq 1 100); do
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST \
    -H 'content-type: application/octet-stream' --data-binary '!' "$(url "$survivor" "$STREAM")")"
  [ "$code" = 204 ] && { ok=1; break; }
  sleep 0.2
done
[ -n "$ok" ] || fail "append after leader kill never succeeded (last: $code)"
pass "append on node $survivor acked after fail-over → 204"

for i in 1 2 3; do
  [ "$i" = "$leader" ] && continue
  for _ in $(seq 1 50); do
    body="$(curl -sf "$(url "$i" "$STREAM")")" || body=""
    [ "$body" = "hello world!" ] && break
    sleep 0.1
  done
  [ "$body" = "hello world!" ] || fail "node $i post-failover read: $(printf %q "$body")"
  pass "survivor node $i reads 'hello world!'"
done

echo "SMOKE OK — create/append/read on all nodes, quorum survives leader loss"
