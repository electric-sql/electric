defmodule Electric.Integration.OracleNestedSubqueryReproTest do
  @moduledoc """
  Reproduction for nested subquery move-out bug.

  Uses the standard 4-level hierarchy with the exact WHERE clause patterns
  that failed in the oracle property test (seed 8, 800 shapes, batch_3):

    shape_275: level_3_id IN (SELECT id FROM level_3 WHERE active = false
               AND level_2_id IN (SELECT id FROM level_2 WHERE active = true))
    shape_300: level_3_id IN (SELECT id FROM level_3 WHERE active = true
               AND level_2_id IN (SELECT id FROM level_2 WHERE active = false))

  Extra row l4-6 (level_3_id=l3-1) was present in materialized view but not
  in oracle — a missing move-out through the nested subquery chain.
  """
  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness
  alias Support.OracleHarness.StandardSchema

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack

  setup ctx do
    ctx = with_electric_client(ctx, router_opts: [long_poll_timeout: 100])
    StandardSchema.setup_standard_schema(ctx)
    ctx
  end

  @shapes [
    # Exact WHERE clause from shape_275
    %{
      name: "nested_false_true",
      table: "level_4",
      where:
        "level_3_id IN (SELECT id FROM level_3 WHERE active = false AND level_2_id IN (SELECT id FROM level_2 WHERE active = true))",
      columns: ["id", "level_3_id", "value"],
      pk: ["id"],
      optimized: false
    },
    # Exact WHERE clause from shape_300
    %{
      name: "nested_true_false",
      table: "level_4",
      where:
        "level_3_id IN (SELECT id FROM level_3 WHERE active = true AND level_2_id IN (SELECT id FROM level_2 WHERE active = false))",
      columns: ["id", "level_3_id", "value"],
      pk: ["id"],
      optimized: false
    }
  ]

  test "nested subquery with random mutations (property-style)", ctx do
    # Run with random mutations like the original test but with only the
    # 2 failing shapes. Should reproduce the bug much faster.
    mutations_per_txn = 10
    txns_per_batch = 5
    batch_count = 20
    total = batch_count * txns_per_batch * mutations_per_txn

    check all mutations <- StandardSchema.mutations_gen(total),
              max_runs: 5 do
      transactions = Enum.chunk_every(mutations, mutations_per_txn)
      batches = Enum.chunk_every(transactions, txns_per_batch)
      test_against_oracle(ctx, @shapes, batches)
    end
  end
end
