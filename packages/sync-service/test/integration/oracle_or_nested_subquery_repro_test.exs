defmodule Electric.Integration.OracleOrNestedSubqueryReproTest do
  @moduledoc """
  Reproduction for OR-of-nested-subqueries move-in/move-out bug.

  Uses the standard 4-level hierarchy with the exact WHERE clause pattern
  that failed in the oracle property test (seed 8, 800 shapes, batch_4):

    shape_442: (level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN
               (SELECT id FROM level_2 WHERE level_1_id IN
               (SELECT id FROM level_1 WHERE active = true))))
           OR (level_3_id IN (SELECT id FROM level_3 WHERE active = false))

  Error: "update for row that does not exist: l4-16"
  The client received an UPDATE for a row not in its materialized view.
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
    %{
      name: "or_nested_inactive",
      table: "level_4",
      where:
        "(level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = true)))) OR (level_3_id IN (SELECT id FROM level_3 WHERE active = false))",
      columns: ["id", "level_3_id", "value"],
      pk: ["id"],
      optimized: false
    }
  ]

  test "OR of nested subquery and simple subquery with random mutations", ctx do
    mutations_per_txn = 10
    txns_per_batch = 10
    batch_count = 10
    total = batch_count * txns_per_batch * mutations_per_txn

    check all mutations <- StandardSchema.mutations_gen(total),
              max_runs: 10 do
      transactions = Enum.chunk_every(mutations, mutations_per_txn)
      batches = Enum.chunk_every(transactions, txns_per_batch)
      test_against_oracle(ctx, @shapes, batches)
    end
  end
end
