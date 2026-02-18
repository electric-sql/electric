defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property-based oracle tests that run many parallel shapes with generated
  where clauses and mutations.

  Reproduce failures with: mix test --include oracle --seed <seed>

  Configuration via environment variables:
    - SHAPE_COUNT: Number of shapes to run in parallel (default: 100)
    - TXN_COUNT: Number of transactions per test (default: 100)
    - MUTATIONS_PER_TXN: Number of mutations per transaction (default: 5)
    - PROP_RUNS: Number of property test iterations (default: 1)
    - LONG_POLL_TIMEOUT: Server long-poll timeout in ms (default: 100)
    - RETRY_WINDOW_MS: Max time to wait for changes after up_to_date (default: 5000)
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness
  import Support.OracleHarness.StandardSchema

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  @default_long_poll_timeout 100
  @default_shape_count 100
  @default_txn_count 100
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
        num_clients: shape_count,
        headers: [{"electric-protocol-version", "2"}]
      )

    setup_standard_schema(ctx)
    ctx
  end

  test "shapes with generated where clauses and mutations", ctx do
    max_runs = env_int("PROP_RUNS") || 1
    shape_count = env_int("SHAPE_COUNT") || @default_shape_count
    txn_count = env_int("TXN_COUNT") || @default_txn_count
    mutations_per_txn = env_int("MUTATIONS_PER_TXN") || @default_mutations_per_txn

    check all iteration_seed <- StreamData.integer(0..10_000),
              max_runs: max_runs do
      IO.puts("[oracle] iteration_seed=#{iteration_seed}")

      shapes = generate_diverse_shapes(shape_count, iteration_seed)
      mutations = generate_mutations(txn_count * mutations_per_txn, iteration_seed + 1)
      transactions = Enum.chunk_every(mutations, mutations_per_txn)

      test_against_oracle(ctx, shapes, transactions)
    end
  end
end
