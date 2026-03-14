defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property-based oracle tests that run many parallel shapes with generated
  where clauses and mutations.

  Reproduce failures with: mix test --include oracle --seed <seed>

  Configuration via environment variables:
    - SHAPE_COUNT: Number of shapes to run in parallel (default: 100)
    - BATCH_COUNT: Number of batches per test (default: 10)
    - TXNS_PER_BATCH: Number of transactions per batch (default: 10)
    - MUTATIONS_PER_TXN: Number of mutations per transaction (default: 5)
    - RUN_COUNT: Number of property test iterations (default: 1)
    - LONG_POLL_TIMEOUT: Server long-poll timeout in ms (default: 100)
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness
  alias Support.OracleHarness.StandardSchema
  alias Support.OracleHarness.WhereClauseGenerator

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  @default_long_poll_timeout 100
  @default_shape_count 100
  @default_batch_count 10
  @default_txns_per_batch 10
  @default_mutations_per_txn 5

  setup [:with_unique_db]
  setup :with_complete_stack

  # Use a short long_poll_timeout to speed up tests - shapes with no changes
  # will get up_to_date faster instead of waiting 4 seconds for the default timeout.
  # Scale server and client connection pools to the shape count so we don't
  # hit Finch pool exhaustion with many concurrent long-polling shapes.
  setup ctx do
    long_poll_timeout = env_int("LONG_POLL_TIMEOUT") || @default_long_poll_timeout
    shape_count = env_int("SHAPE_COUNT") || @default_shape_count

    ctx =
      with_electric_client(ctx,
        router_opts: [long_poll_timeout: long_poll_timeout],
        num_clients: shape_count
      )

    StandardSchema.setup_standard_schema(ctx)
    ctx
  end

  # Keep only the first mutation per row within a transaction to avoid
  # multiple mutations to the same row in a single transaction.
  defp dedup_transaction(mutations) do
    mutations
    |> Enum.uniq_by(& &1.row_key)
  end

  test "shapes with generated where clauses and mutations", ctx do
    run_count = env_int("RUN_COUNT") || 1
    shape_count = env_int("SHAPE_COUNT") || @default_shape_count
    batch_count = env_int("BATCH_COUNT") || @default_batch_count
    txns_per_batch = env_int("TXNS_PER_BATCH") || @default_txns_per_batch
    mutations_per_txn = env_int("MUTATIONS_PER_TXN") || @default_mutations_per_txn

    total_mutations = batch_count * txns_per_batch * mutations_per_txn

    check all shapes <- WhereClauseGenerator.shapes_gen(shape_count),
              mutations <- StandardSchema.mutations_gen(total_mutations),
              max_runs: run_count do
      transactions =
        mutations
        |> Enum.chunk_every(mutations_per_txn)
        |> Enum.map(&dedup_transaction/1)

      batches = Enum.chunk_every(transactions, txns_per_batch)
      test_against_oracle(ctx, shapes, batches)
    end
  end
end
