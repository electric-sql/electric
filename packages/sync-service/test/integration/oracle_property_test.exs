defmodule Electric.Integration.OraclePropertyTest do
  @moduledoc """
  Property-based oracle tests that run many parallel shapes with generated
  where clauses and mutations.

  Configuration via environment variables:
    - SHAPE_COUNT: Number of shapes to run in parallel (default: 100)
    - MUTATION_COUNT: Number of mutations per test (default: 20)
    - PROP_RUNS: Number of property test iterations (default: 5)
    - WHERE_SEED: Seed for where clause generation (if unset, varies each iteration)
    - MUTATION_SEED: Seed for mutation generation (if unset, varies each iteration)

  Run with: mix test --include oracle
  """

  use ExUnit.Case, async: false
  use ExUnitProperties

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.IntegrationSetup
  import Support.OracleHarness

  @moduletag :oracle
  @moduletag timeout: :infinity
  @moduletag :tmp_dir

  setup [:with_unique_db]
  setup :with_complete_stack
  setup :with_electric_client

  setup ctx do
    setup_standard_schema(ctx)
    :ok
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
    fixed_where_seed = env_int("WHERE_SEED")
    fixed_mutation_seed = env_int("MUTATION_SEED")

    check all iteration_seed <- StreamData.integer(),
              max_runs: max_runs do
      run_parallel(ctx, %{
        where_seed: fixed_where_seed || iteration_seed,
        mutation_seed: fixed_mutation_seed || iteration_seed + 1
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
