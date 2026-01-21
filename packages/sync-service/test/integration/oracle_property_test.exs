defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property-based oracle tests that run many parallel shapes with generated
  where clauses and mutations.

  Configuration via environment variables:
    - ELECTRIC_ORACLE_SHAPE_COUNT: Number of shapes to run in parallel (default: 100)
    - ELECTRIC_ORACLE_MUTATION_COUNT: Number of mutations per test (default: 20)
    - ELECTRIC_ORACLE_PROP_RUNS: Number of property test iterations (default: 5)
    - ELECTRIC_ORACLE_WHERE_SEED: Seed for where clause generation (default: random)
    - ELECTRIC_ORACLE_MUTATION_SEED: Seed for mutation generation (default: random)
    - ELECTRIC_ORACLE_TIMEOUT_MS: Timeout per shape wait (default: 20000)
    - ELECTRIC_ORACLE_VERBOSE: Set to "1" for verbose logging
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  setup ctx do
    setup_standard_schema(ctx)
    :ok
  end

  @doc """
  Run parallel shapes with fully generated where clauses and mutations.

  Each iteration:
  1. Resets data to initial seed state
  2. Generates shape_count where clauses (with new seed each iteration)
  3. Generates mutation_count mutations (with new seed each iteration)
  4. Runs all shapes in parallel, applying mutations and verifying consistency
  """
  test "parallel shapes with generated where clauses and mutations", ctx do
    max_runs = env_int("ELECTRIC_ORACLE_PROP_RUNS") || 5

    check all iteration_seed <- StreamData.integer(),
              max_runs: max_runs do
      # Reset data for clean state each iteration
      reset_standard_data(ctx)

      # Use iteration seed to generate different shapes/mutations each run
      run_parallel(ctx, %{
        where_seed: iteration_seed,
        mutation_seed: iteration_seed + 1
      })
    end
  end

  @doc """
  Run with fixed where clauses but varying mutations.

  This tests that the same set of shapes handles different mutation sequences correctly.
  """
  test "fixed shapes with varying mutations", ctx do
    max_runs = env_int("ELECTRIC_ORACLE_PROP_RUNS") || 5
    fixed_where_seed = env_int("ELECTRIC_ORACLE_WHERE_SEED") || 12345

    check all mutation_seed <- StreamData.integer(),
              max_runs: max_runs do
      reset_standard_data(ctx)

      run_parallel(ctx, %{
        where_seed: fixed_where_seed,
        mutation_seed: mutation_seed
      })
    end
  end

  @doc """
  Run with fixed mutations but varying where clauses.

  This tests that different shape definitions all produce correct results
  for the same mutation sequence.
  """
  test "varying shapes with fixed mutations", ctx do
    max_runs = env_int("ELECTRIC_ORACLE_PROP_RUNS") || 5
    fixed_mutation_seed = env_int("ELECTRIC_ORACLE_MUTATION_SEED") || 54321

    check all where_seed <- StreamData.integer(),
              max_runs: max_runs do
      reset_standard_data(ctx)

      run_parallel(ctx, %{
        where_seed: where_seed,
        mutation_seed: fixed_mutation_seed
      })
    end
  end

  defp env_int(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.to_integer(value)
    end
  end
end
