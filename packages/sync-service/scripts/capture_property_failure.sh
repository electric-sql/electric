#!/usr/bin/env bash
#
# Runs the consumer property test and, on failure, extracts the shrunk
# Scenario.new(...) block and writes a standalone reproduction test file.
#
# Usage:
#   scripts/capture_property_failure.sh          # random seed
#   scripts/capture_property_failure.sh 12345    # specific seed

set -euo pipefail

PROP_TEST="test/electric/shapes/consumer_property_test.exs"
OUTPUT_DIR="test/electric/shapes"

SEED="${1:-}"
SEED_ARGS=()
if [ -n "$SEED" ]; then
  SEED_ARGS=(--seed "$SEED")
fi

echo "Running property test${SEED:+ with seed $SEED}..."

# Run test, strip ANSI codes
if [ ${#SEED_ARGS[@]} -eq 0 ]; then
  # No seed specified, run with --repeat-until-failure 10
  if OUTPUT=$(mix test "$PROP_TEST" --repeat-until-failure 10 2>&1 | perl -pe 's/\e\[[0-9;]*m//g'); then
    echo "All tests passed."
    exit 0
  fi
else
  if OUTPUT=$(mix test "$PROP_TEST" "${SEED_ARGS[@]}" 2>&1 | perl -pe 's/\e\[[0-9;]*m//g'); then
    echo "All tests passed."
    exit 0
  fi
fi

# Extract seed
ACTUAL_SEED=$(echo "$OUTPUT" | grep -oE 'seed[: ]+[0-9]+' | head -1 | grep -oE '[0-9]+')
if [ -z "$ACTUAL_SEED" ]; then
  echo "ERROR: Could not determine seed from output"
  exit 1
fi

echo "Failure found (seed $ACTUAL_SEED). Extracting scenario..."

# Extract Scenario.new(...) block by tracking parenthesis depth.
# First line: strip everything before "Scenario.new(".
# Subsequent lines: strip 9 leading spaces (the output indent of the closing paren).
# Stop when paren depth returns to 0.
SCENARIO=$(echo "$OUTPUT" | awk '
/Generated: Scenario\.new\(/ {
  cap = 1
  depth = 0
  line = $0
  sub(/.*Generated: /, "", line)
  tmp = line; gsub(/[^(]/, "", tmp); depth += length(tmp)
  tmp = line; gsub(/[^)]/, "", tmp); depth -= length(tmp)
  print line
  if (depth <= 0) cap = 0
  next
}
cap {
  line = $0
  tmp = line; gsub(/[^(]/, "", tmp); depth += length(tmp)
  tmp = line; gsub(/[^)]/, "", tmp); depth -= length(tmp)
  sub(/^         /, "", line)
  print line
  if (depth <= 0) cap = 0
}')

if [ -z "$SCENARIO" ]; then
  echo "ERROR: Could not extract Scenario.new() from output"
  exit 1
fi

# Build the reproduction test module in a temp file
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

OUTPUT_TEST="$OUTPUT_DIR/tmp_consumer_failure_reproduction_seed_${ACTUAL_SEED}_test.exs"
MODULE_NAME="Electric.Shapes.TmpConsumerFailureReproductionSeed${ACTUAL_SEED}Test"

cat > "$TMPFILE" <<EOF
defmodule $MODULE_NAME do
  use ExUnit.Case, async: true
  use Repatch.ExUnit, assert_expectations: true

  alias Electric.Shapes.Shape

  alias Support.StubInspector
  alias Support.ConsumerProperty.Runner
  alias Support.ConsumerProperty.Scenario

  import Support.ComponentSetup

  @inspector StubInspector.new(
               tables: ["test_table", "other_table"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0},
                 %{name: "parent_id", type: "int8"},
                 %{name: "value", type: "text"}
               ]
             )

  @moduletag :tmp_dir

  setup :with_stack_id_from_test

  setup ctx do
    inspector = Map.get(ctx, :with_inspector, @inspector)
    %{inspector: inspector, pool: nil}
  end

  setup ctx do
    Electric.StackConfig.put(ctx.stack_id, :shape_hibernate_after, 60_000)
    Electric.StackConfig.put(ctx.stack_id, :feature_flags, ["tagged_subqueries"])
    :ok
  end

  setup [
    :with_registry,
    :with_pure_file_storage,
    :with_shape_status,
    :with_lsn_tracker,
    :with_log_chunking,
    :with_persistent_kv,
    :with_async_deleter,
    :with_shape_cleaner,
    :with_shape_log_collector,
    :with_noop_publication_manager,
    :with_status_monitor,
    {Runner, :with_patched_snapshotter},
    :with_shape_cache
  ]

  defp subquery_shape(ctx) do
    Shape.new!("public.test_table",
      inspector: ctx.inspector,
      where: "parent_id IN (SELECT id FROM other_table)"
    )
  end

  @tag timeout: 120_000
  test "captured property repro (seed $ACTUAL_SEED)", ctx do
    scenario =
EOF

# Append scenario indented by 8 spaces
echo "$SCENARIO" | sed 's/^/        /' >> "$TMPFILE"

cat >> "$TMPFILE" <<'EOF'

    Runner.run_scenario(ctx, scenario,
      shape: subquery_shape(ctx),
      extended_output: true
    )
  end
end
EOF

mv "$TMPFILE" "$OUTPUT_TEST"

# Format only the generated test file
mix format "$OUTPUT_TEST"

# Find line number of the generated test
NEW_LINE=$(grep -n "captured property repro (seed $ACTUAL_SEED)" "$OUTPUT_TEST" | tail -1 | cut -d: -f1)

echo ""
echo "Wrote reproduction test for seed $ACTUAL_SEED."
echo "Run with:"
echo "  mix test $OUTPUT_TEST:$NEW_LINE"

exit 1
