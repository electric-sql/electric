#!/usr/bin/env bash

set -euo pipefail

# gen_shapes.sh — create a table and generate N shapes via the Electric API
#
# Requirements:
# - DATABASE_URL must point to a reachable Postgres instance that psql can use
# - Electric API is available at http://localhost:${ELECTRIC_PORT:-3000}
# - Optional: ELECTRIC_SECRET will be appended as a query param if set
#
# Usage:
#   ./dev/gen_shapes.sh NUM_SHAPES
#   NUM_SHAPES can also be provided via env var NUM_SHAPES
#   Configure parallelism with CONCURRENCY (default: min(32, 2*CPU cores))

NUM_SHAPES_INPUT=${1:-${NUM_SHAPES:-}}
if [[ -z "${NUM_SHAPES_INPUT}" ]]; then
	echo "Usage: $0 NUM_SHAPES" >&2
	exit 1
fi

if ! [[ "${NUM_SHAPES_INPUT}" =~ ^[0-9]+$ ]]; then
	echo "NUM_SHAPES must be a positive integer" >&2
	exit 1
fi

NUM_SHAPES=${NUM_SHAPES_INPUT}

if [[ -z "${DATABASE_URL:-}" ]]; then
	echo "DATABASE_URL is not set. Please export DATABASE_URL with a Postgres URI." >&2
	exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
	echo "psql is required but not found in PATH" >&2
	exit 1
fi

ELECTRIC_PORT=${ELECTRIC_PORT:-3000}
BASE_URL="http://localhost:${ELECTRIC_PORT}/v1/shape"

# Create table 'foo' suitable for where clauses like id={i} and seed rows 1..NUM_SHAPES
echo "Creating table 'foo' (if not exists) and seeding ${NUM_SHAPES} rows in Postgres..."
psql -v ON_ERROR_STOP=1 -d "${DATABASE_URL}" <<SQL
CREATE TABLE IF NOT EXISTS public.foo (
	id   integer PRIMARY KEY,
	data text
);

INSERT INTO public.foo (id, data)
SELECT i, 'row-' || i::text
FROM generate_series(1, ${NUM_SHAPES}) AS s(i)
ON CONFLICT (id) DO NOTHING;
SQL

echo "Generating ${NUM_SHAPES} shapes against Electric at ${BASE_URL}..."

# Build optional secret query param
SECRET_QS=""
if [[ -n "${ELECTRIC_SECRET:-}" ]]; then
	# The API accepts either 'secret' or 'api_secret'; prefer 'secret'
	SECRET_QS="&secret=$(printf %s "${ELECTRIC_SECRET}" | sed -e 's/\&/%26/g' -e 's/\?/%3F/g')"
fi

# Determine concurrency
CPU_CORES=1
if command -v sysctl >/dev/null 2>&1; then
	CPU_CORES=$(sysctl -n hw.ncpu 2>/dev/null || echo 1)
fi
DEFAULT_CONCURRENCY=$(( CPU_CORES * 2 ))
if (( DEFAULT_CONCURRENCY > 32 )); then DEFAULT_CONCURRENCY=32; fi
CONCURRENCY=${CONCURRENCY:-$DEFAULT_CONCURRENCY}

echo "Using concurrency: ${CONCURRENCY}"

# Temp dir for artifacts
TMP_DIR=$(mktemp -d -t gen_shapes.XXXXXX)
cleanup() {
	rm -rf "${TMP_DIR}" 2>/dev/null || true
}
trap cleanup EXIT

# Sequence generator (portable across macOS/Linux)
gen_sequence() {
	local n=$1
	if command -v seq >/dev/null 2>&1; then
		seq 1 "$n"
	elif command -v jot >/dev/null 2>&1; then
		jot -w "%d" "$n" 1
	else
		awk -v n="$n" 'BEGIN{for(i=1;i<=n;i++) print i}'
	fi
}

export BASE_URL SECRET_QS TMP_DIR

gen_sequence "$NUM_SHAPES" | xargs -P "$CONCURRENCY" -n 1 -I {} bash -c '
	i="$1"
	url="${BASE_URL}?table=foo&where=id=${i}&offset=-1${SECRET_QS}"
	body="${TMP_DIR}/shape_${i}.json"
	status_file="${TMP_DIR}/shape_${i}.status"

	code=$(curl -sS --max-time 15 --retry 2 --retry-delay 1 \
			-H "Accept: application/json" \
			--write-out "%{http_code}" \
			--output "$body" \
			--fail-with-body \
			"$url" 2>/dev/null || echo "000")

	printf "%s" "$code" > "$status_file"

	if [[ "$code" == "200" || "$code" == "304" ]]; then
		exit 0
	else
		# Keep a small snippet for debugging
		if [[ -s "$body" ]]; then
			head -c 200 "$body" > "${body}.snippet" 2>/dev/null || true
		fi
		exit 1
	fi
' _ {}

# Summarize results
total_status=0
successes=0
failures=0
if ls "${TMP_DIR}"/*.status >/dev/null 2>&1; then
	total_status=$(ls "${TMP_DIR}"/*.status | wc -l | tr -d ' ')
	successes=$(grep -E -h "^(200|304)$" "${TMP_DIR}"/*.status | wc -l | tr -d ' ')
	failures=$(( total_status - successes ))
fi

if (( failures > 0 )); then
	echo "Completed with ${failures} failures out of ${total_status}." >&2
	# Print up to 5 example failures
	count=0
	for f in "${TMP_DIR}"/*.status; do
		[[ -e "$f" ]] || break
		code=$(cat "$f")
		if [[ "$code" != "200" && "$code" != "304" ]]; then
			i=${f##*/}
			i=${i#shape_}
			i=${i%.status}
			echo "- where=id=${i}: HTTP ${code}" >&2
			if [[ -s "${TMP_DIR}/shape_${i}.json.snippet" ]]; then
				echo "  Response: $(cat "${TMP_DIR}/shape_${i}.json.snippet")" >&2
			fi
			count=$((count+1))
			if (( count >= 5 )); then break; fi
		fi
	done
	if [[ -z "${ELECTRIC_SECRET:-}" ]]; then
		echo "Note: If your Electric server requires an API secret, set ELECTRIC_SECRET and rerun." >&2
	fi
	exit 1
fi

echo "All ${total_status} shapes generated successfully."

