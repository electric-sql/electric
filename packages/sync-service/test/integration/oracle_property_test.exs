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
    - RESTART_SERVER_EVERY: Stop and restart the sync stack every N batches to
      test server-side restore-from-file (default: 0, disabled). After each
      restart, fresh clients reconnect and check_initial_state asserts the
      restored state matches the oracle.
    - RESTART_TYPE: How the RESTART_SERVER_EVERY restart is performed:
      "graceful" (default, clean shutdown + restore from disk), "brutal"
      (kill -9 style crash + recover), or "rolling" (rolling deploy: a new
      stack takes over the replication slot before the old one is stopped).
      See `Support.OracleHarness.RestartStrategy`.
    - RETRY_TRANSIENT_ERRORS: When "true"/"1", a transient poll error (5xx or a
      connection error) is retried within the check timeout instead of failing
      the test. These are availability blips that production hides from clients
      during a restart/deploy, so they are not consistency signals. Default off
      (any poll error fails, preserving current behaviour). 409/must-refetch and
      4xx errors and data mismatches always fail regardless of this flag.
    - RESTART_CLIENT_EVERY: Throw away clients (poll cursors, materialized
      rows) and reconnect every M batches to test that fresh polls correctly
      assemble snapshot + log (default: 0, disabled). Independent of
      RESTART_SERVER_EVERY.
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
  setup :use_persistent_slot
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

  # The replication slot must survive the StackSupervisor restart used by
  # RESTART_SERVER_EVERY, otherwise Electric correctly treats the new slot
  # as a slot-loss event and purges all on-disk shape data — defeating the
  # restore-from-file scenario. Always run with a persistent slot; the slot
  # is dropped automatically with the per-test database in `after_suite`.
  defp use_persistent_slot(_ctx) do
    %{replication_opts_overrides: [slot_temporary?: false]}
  end

  test "shapes with generated where clauses and mutations", ctx do
    run_count = env_int("RUN_COUNT") || 1
    shape_count = env_int("SHAPE_COUNT") || @default_shape_count
    batch_count = env_int("BATCH_COUNT") || @default_batch_count
    txns_per_batch = env_int("TXNS_PER_BATCH") || @default_txns_per_batch
    mutations_per_txn = env_int("MUTATIONS_PER_TXN") || @default_mutations_per_txn
    restart_server_every = env_int("RESTART_SERVER_EVERY") || 0
    restart_client_every = env_int("RESTART_CLIENT_EVERY") || 0

    total_mutations = batch_count * txns_per_batch * mutations_per_txn

    check all shapes <- WhereClauseGenerator.shapes_gen(shape_count),
              mutations <- StandardSchema.mutations_gen(total_mutations),
              max_runs: run_count do
      transactions = Enum.chunk_every(mutations, mutations_per_txn)
      batches = Enum.chunk_every(transactions, txns_per_batch)

      test_against_oracle(ctx, shapes, batches,
        restart_server_every: restart_server_every,
        restart_client_every: restart_client_every
      )
    end
  end
end
