defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property-based oracle tests that run many parallel shapes with generated
  where clauses and mutations.

  Configuration via environment variables:
    - SHAPE_COUNT: Number of shapes to run in parallel (default: 100)
    - MUTATION_COUNT: Number of mutations per test (default: 100)
    - PROP_RUNS: Number of property test iterations (default: 1)
    - WHERE_SEED: Seed for where clause generation (if unset, varies each iteration)
    - MUTATION_SEED: Seed for mutation generation (if unset, varies each iteration)
    - LONG_POLL_TIMEOUT: Server long-poll timeout in ms (default: 100)
    - RETRY_WINDOW_MS: Max time to wait for changes after up_to_date (default: 2000)

  Run with: mix test --include oracle
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
  @default_mutation_count 100

  setup [:with_unique_db]
  setup :with_complete_stack

  # Use a short long_poll_timeout to speed up tests - shapes with no changes
  # will get up_to_date faster instead of waiting 4 seconds for the default timeout
  setup ctx do
    long_poll_timeout = env_int("LONG_POLL_TIMEOUT") || @default_long_poll_timeout
    ctx = with_electric_client(ctx, router_opts: [long_poll_timeout: long_poll_timeout])
    setup_standard_schema(ctx)
    ctx
  end

  @doc """
  Run parallel shapes with generated where clauses and mutations.

  Each seed is either taken from the environment variable (if set) or generated
  randomly. This allows:
  - Neither set → both vary
  - WHERE_SEED set → fixed shapes, varying mutations
  - MUTATION_SEED set → varying shapes, fixed mutations
  - Both set → fully deterministic (useful for reproducing failures)
  """
  test "parallel shapes with generated where clauses and mutations", ctx do
    max_runs = env_int("PROP_RUNS") || 1
    shape_count = env_int("SHAPE_COUNT") || @default_shape_count
    mutation_count = env_int("MUTATION_COUNT") || @default_mutation_count
    fixed_where_seed = env_int("WHERE_SEED")
    fixed_mutation_seed = env_int("MUTATION_SEED")

    check all iteration_seed <- StreamData.integer(),
              max_runs: max_runs do
      where_seed = fixed_where_seed || iteration_seed
      mutation_seed = fixed_mutation_seed || iteration_seed + 1

      IO.puts("[oracle] Generating shapes with WHERE_SEED=#{where_seed} MUTATION_SEED=#{mutation_seed}")

      shapes = generate_shapes(shape_count, where_seed)
      mutations = generate_mutations(mutation_count, mutation_seed)

      test_against_oracle(ctx, shapes, mutations)
    end
  end
end
