defmodule Support.OracleHarness do
  @moduledoc """
  Harness for comparing Electric shape streams against Postgres query results.

  Supports running many shapes in parallel on a shared schema to maximize
  test throughput while minimizing setup overhead.

  ## Standard Schema

  The standard schema has 4 levels of hierarchy plus tags at each level:

      level_1 (id, active)
          ├── level_1_tags (level_1_id, tag)
          └── level_2 (id, level_1_id, active)
                  ├── level_2_tags (level_2_id, tag)
                  └── level_3 (id, level_2_id, active)
                          ├── level_3_tags (level_3_id, tag)
                          └── level_4 (id, level_3_id, value)

  This supports testing subqueries up to 4 levels deep.
  """

  alias Support.OracleHarness.ShapeChecker

  @default_timeout_ms 20_000
  @default_shape_count 100
  @default_mutation_count 100
  @default_oracle_pool_size 50

  # Standard IDs for seeded data
  @level_1_ids Enum.map(1..5, &"l1-#{&1}")
  @level_2_ids Enum.map(1..5, &"l2-#{&1}")
  @level_3_ids Enum.map(1..5, &"l3-#{&1}")
  @level_4_ids Enum.map(1..20, &"l4-#{&1}")
  @tags ["alpha", "beta", "gamma", "delta"]

  # ----------------------------------------------------------------------------
  # Standard Schema
  # ----------------------------------------------------------------------------

  def standard_schema_sql do
    [
      "DROP TABLE IF EXISTS level_4 CASCADE",
      "DROP TABLE IF EXISTS level_3_tags CASCADE",
      "DROP TABLE IF EXISTS level_3 CASCADE",
      "DROP TABLE IF EXISTS level_2_tags CASCADE",
      "DROP TABLE IF EXISTS level_2 CASCADE",
      "DROP TABLE IF EXISTS level_1_tags CASCADE",
      "DROP TABLE IF EXISTS level_1 CASCADE",
      """
      CREATE TABLE level_1 (
        id TEXT PRIMARY KEY,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_1_tags (
        level_1_id TEXT NOT NULL REFERENCES level_1(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_1_id, tag)
      )
      """,
      """
      CREATE TABLE level_2 (
        id TEXT PRIMARY KEY,
        level_1_id TEXT NOT NULL REFERENCES level_1(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_2_tags (
        level_2_id TEXT NOT NULL REFERENCES level_2(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_2_id, tag)
      )
      """,
      """
      CREATE TABLE level_3 (
        id TEXT PRIMARY KEY,
        level_2_id TEXT NOT NULL REFERENCES level_2(id) ON DELETE CASCADE,
        active BOOLEAN NOT NULL DEFAULT true
      )
      """,
      """
      CREATE TABLE level_3_tags (
        level_3_id TEXT NOT NULL REFERENCES level_3(id) ON DELETE CASCADE,
        tag TEXT NOT NULL,
        PRIMARY KEY (level_3_id, tag)
      )
      """,
      """
      CREATE TABLE level_4 (
        id TEXT PRIMARY KEY,
        level_3_id TEXT NOT NULL REFERENCES level_3(id) ON DELETE CASCADE,
        value TEXT NOT NULL
      )
      """
    ]
  end

  def standard_seed_sql do
    level_1_values =
      @level_1_ids
      |> Enum.with_index()
      |> Enum.map(fn {id, idx} -> "('#{id}', #{rem(idx, 2) == 0})" end)
      |> Enum.join(", ")

    level_2_values =
      for {l2_id, idx} <- Enum.with_index(@level_2_ids) do
        l1_id = Enum.at(@level_1_ids, rem(idx, length(@level_1_ids)))
        "('#{l2_id}', '#{l1_id}', #{rem(idx, 2) == 0})"
      end
      |> Enum.join(", ")

    level_3_values =
      for {l3_id, idx} <- Enum.with_index(@level_3_ids) do
        l2_id = Enum.at(@level_2_ids, rem(idx, length(@level_2_ids)))
        "('#{l3_id}', '#{l2_id}', #{rem(idx, 2) == 0})"
      end
      |> Enum.join(", ")

    level_4_values =
      for {l4_id, idx} <- Enum.with_index(@level_4_ids) do
        l3_id = Enum.at(@level_3_ids, rem(idx, length(@level_3_ids)))
        "('#{l4_id}', '#{l3_id}', 'v#{idx}')"
      end
      |> Enum.join(", ")

    # Tags: assign tags in a pattern so we get variety
    level_1_tag_values =
      for {l1_id, idx} <- Enum.with_index(@level_1_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l1_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    level_2_tag_values =
      for {l2_id, idx} <- Enum.with_index(@level_2_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l2_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    level_3_tag_values =
      for {l3_id, idx} <- Enum.with_index(@level_3_ids),
          tag <- Enum.take(@tags, rem(idx, length(@tags)) + 1) do
        "('#{l3_id}', '#{tag}')"
      end
      |> Enum.join(", ")

    [
      "INSERT INTO level_1 (id, active) VALUES #{level_1_values}",
      "INSERT INTO level_2 (id, level_1_id, active) VALUES #{level_2_values}",
      "INSERT INTO level_3 (id, level_2_id, active) VALUES #{level_3_values}",
      "INSERT INTO level_4 (id, level_3_id, value) VALUES #{level_4_values}",
      "INSERT INTO level_1_tags (level_1_id, tag) VALUES #{level_1_tag_values}",
      "INSERT INTO level_2_tags (level_2_id, tag) VALUES #{level_2_tag_values}",
      "INSERT INTO level_3_tags (level_3_id, tag) VALUES #{level_3_tag_values}"
    ]
  end

  def level_1_ids, do: @level_1_ids
  def level_2_ids, do: @level_2_ids
  def level_3_ids, do: @level_3_ids
  def level_4_ids, do: @level_4_ids
  def tags, do: @tags

  # ----------------------------------------------------------------------------
  # Where Clause Generation
  # ----------------------------------------------------------------------------

  @doc """
  Generates a list of where clause specs for level_4 shapes.

  Each spec is a map with :where (the SQL clause) and :optimized (boolean).
  Uses the provided seed for deterministic generation.
  """
  def generate_where_clauses(count, seed \\ nil) do
    :rand.seed(:exsss, seed || :erlang.monotonic_time())

    Enum.map(1..count, fn idx ->
      generate_one_where_clause(idx)
    end)
  end

  defp generate_one_where_clause(idx) do
    # Mix of different subquery depths
    case rem(idx, 10) do
      # Simple equality (optimized)
      0 -> simple_where_clause()
      1 -> simple_where_clause()
      # 1-level subquery
      2 -> one_level_subquery()
      3 -> one_level_subquery()
      4 -> one_level_subquery()
      # 2-level subquery
      5 -> two_level_subquery()
      6 -> two_level_subquery()
      # 3-level subquery
      7 -> three_level_subquery()
      8 -> three_level_subquery()
      # Tag-based subquery
      9 -> tag_based_subquery()
    end
  end

  defp simple_where_clause do
    case :rand.uniform(3) do
      1 ->
        l3_id = Enum.random(@level_3_ids)
        %{where: "level_3_id = '#{l3_id}'", optimized: true}

      2 ->
        l4_id = Enum.random(@level_4_ids)
        %{where: "id = '#{l4_id}'", optimized: true}

      3 ->
        %{where: "value LIKE 'v%'", optimized: true}
    end
  end

  defp one_level_subquery do
    case :rand.uniform(2) do
      1 ->
        # level_3_id IN (SELECT id FROM level_3 WHERE active = true/false)
        active = Enum.random([true, false])

        %{
          where: "level_3_id IN (SELECT id FROM level_3 WHERE active = #{active})",
          optimized: false
        }

      2 ->
        # level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = 'x')
        l2_id = Enum.random(@level_2_ids)

        %{
          where: "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id = '#{l2_id}')",
          optimized: false
        }
    end
  end

  defp two_level_subquery do
    case :rand.uniform(2) do
      1 ->
        # Through active flags
        active_l3 = Enum.random([true, false])
        active_l2 = Enum.random([true, false])

        %{
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE active = #{active_l3} AND level_2_id IN (SELECT id FROM level_2 WHERE active = #{active_l2}))",
          optimized: false
        }

      2 ->
        # Through specific level_1_id
        l1_id = Enum.random(@level_1_ids)

        %{
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id = '#{l1_id}'))",
          optimized: false
        }
    end
  end

  defp three_level_subquery do
    active_l1 = Enum.random([true, false])

    %{
      where:
        "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE active = #{active_l1})))",
      optimized: false
    }
  end

  defp tag_based_subquery do
    tag = Enum.random(@tags)
    level = :rand.uniform(3)

    case level do
      1 ->
        %{
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE id IN (SELECT level_3_id FROM level_3_tags WHERE tag = '#{tag}'))",
          optimized: false
        }

      2 ->
        %{
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE id IN (SELECT level_2_id FROM level_2_tags WHERE tag = '#{tag}')))",
          optimized: false
        }

      3 ->
        %{
          where:
            "level_3_id IN (SELECT id FROM level_3 WHERE level_2_id IN (SELECT id FROM level_2 WHERE level_1_id IN (SELECT id FROM level_1 WHERE id IN (SELECT level_1_id FROM level_1_tags WHERE tag = '#{tag}'))))",
          optimized: false
        }
    end
  end

  # ----------------------------------------------------------------------------
  # Mutation Generation
  # ----------------------------------------------------------------------------

  @doc """
  Generates a list of mutations to apply.
  """
  def generate_mutations(count, seed \\ nil) do
    :rand.seed(:exsss, seed || :erlang.monotonic_time())

    Enum.map(1..count, fn idx ->
      generate_one_mutation(idx)
    end)
  end

  defp generate_one_mutation(idx) do
    case rem(idx, 8) do
      0 -> toggle_level_1_active()
      1 -> toggle_level_2_active()
      2 -> toggle_level_3_active()
      3 -> move_level_2_parent()
      4 -> move_level_3_parent()
      5 -> move_level_4_parent()
      6 -> add_or_remove_tag()
      7 -> update_level_4_value()
    end
  end

  defp toggle_level_1_active do
    id = Enum.random(@level_1_ids)
    %{name: "toggle_l1_#{id}", sql: "UPDATE level_1 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp toggle_level_2_active do
    id = Enum.random(@level_2_ids)
    %{name: "toggle_l2_#{id}", sql: "UPDATE level_2 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp toggle_level_3_active do
    id = Enum.random(@level_3_ids)
    %{name: "toggle_l3_#{id}", sql: "UPDATE level_3 SET active = NOT active WHERE id = '#{id}'"}
  end

  defp move_level_2_parent do
    id = Enum.random(@level_2_ids)
    new_parent = Enum.random(@level_1_ids)

    %{
      name: "move_l2_#{id}_to_#{new_parent}",
      sql: "UPDATE level_2 SET level_1_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp move_level_3_parent do
    id = Enum.random(@level_3_ids)
    new_parent = Enum.random(@level_2_ids)

    %{
      name: "move_l3_#{id}_to_#{new_parent}",
      sql: "UPDATE level_3 SET level_2_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp move_level_4_parent do
    id = Enum.random(@level_4_ids)
    new_parent = Enum.random(@level_3_ids)

    %{
      name: "move_l4_#{id}_to_#{new_parent}",
      sql: "UPDATE level_4 SET level_3_id = '#{new_parent}' WHERE id = '#{id}'"
    }
  end

  defp add_or_remove_tag do
    level = :rand.uniform(3)
    tag = Enum.random(@tags)

    case level do
      1 ->
        id = Enum.random(@level_1_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l1_#{id}_#{tag}",
            sql:
              "INSERT INTO level_1_tags (level_1_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l1_#{id}_#{tag}",
            sql: "DELETE FROM level_1_tags WHERE level_1_id = '#{id}' AND tag = '#{tag}'"
          }
        end

      2 ->
        id = Enum.random(@level_2_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l2_#{id}_#{tag}",
            sql:
              "INSERT INTO level_2_tags (level_2_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l2_#{id}_#{tag}",
            sql: "DELETE FROM level_2_tags WHERE level_2_id = '#{id}' AND tag = '#{tag}'"
          }
        end

      3 ->
        id = Enum.random(@level_3_ids)

        if :rand.uniform(2) == 1 do
          %{
            name: "add_tag_l3_#{id}_#{tag}",
            sql:
              "INSERT INTO level_3_tags (level_3_id, tag) VALUES ('#{id}', '#{tag}') ON CONFLICT DO NOTHING"
          }
        else
          %{
            name: "remove_tag_l3_#{id}_#{tag}",
            sql: "DELETE FROM level_3_tags WHERE level_3_id = '#{id}' AND tag = '#{tag}'"
          }
        end
    end
  end

  defp update_level_4_value do
    id = Enum.random(@level_4_ids)
    new_value = "v#{:rand.uniform(1000)}"

    %{
      name: "update_l4_#{id}",
      sql: "UPDATE level_4 SET value = '#{new_value}' WHERE id = '#{id}'"
    }
  end

  # ----------------------------------------------------------------------------
  # Main Test Runner
  # ----------------------------------------------------------------------------

  def default_opts_from_env do
    %{
      shape_count: env_int("SHAPE_COUNT") || @default_shape_count,
      mutation_count: env_int("MUTATION_COUNT") || @default_mutation_count,
      oracle_pool_size: env_int("ORACLE_POOL_SIZE") || @default_oracle_pool_size,
      where_seed: env_int("WHERE_SEED"),
      mutation_seed: env_int("MUTATION_SEED")
    }
  end

  @doc """
  Sets up the standard schema and seeds it with data.
  Call this once before running tests.
  """
  def setup_standard_schema(ctx) do
    apply_sql(ctx, standard_schema_sql())
    apply_sql(ctx, standard_seed_sql())
    :ok
  end

  @doc """
  Resets the standard schema data to its initial seeded state.
  Faster than full schema recreation.
  """
  def reset_standard_data(ctx) do
    # Delete in reverse order of dependencies (avoid TRUNCATE which invalidates shapes via replication)
    apply_sql(ctx, [
      "DELETE FROM level_4",
      "DELETE FROM level_3_tags",
      "DELETE FROM level_3",
      "DELETE FROM level_2_tags",
      "DELETE FROM level_2",
      "DELETE FROM level_1_tags",
      "DELETE FROM level_1"
    ])

    apply_sql(ctx, standard_seed_sql())
    :ok
  end

  @doc """
  Runs parallel shapes with generated where clauses and mutations.

  Options:
    - :shape_count - number of shapes to run in parallel (default: 100)
    - :mutation_count - number of mutations to apply (default: 20)
    - :where_seed - seed for where clause generation (default: random)
    - :mutation_seed - seed for mutation generation (default: random)
    - :timeout_ms - timeout for waiting on shapes (default: 20_000)
    - :verbose - whether to log progress (default: false)
  """
  def run_parallel(ctx, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)

    # Use provided seeds or generate random ones
    where_seed = opts[:where_seed] || :erlang.monotonic_time()
    mutation_seed = opts[:mutation_seed] || :erlang.monotonic_time()

    log("Generating shapes with WHERE_SEED=#{where_seed} MUTATION_SEED=#{mutation_seed}")

    where_clauses = generate_where_clauses(opts.shape_count, where_seed)
    mutations = generate_mutations(opts.mutation_count, mutation_seed)

    shapes =
      where_clauses
      |> Enum.with_index(1)
      |> Enum.map(fn {where_spec, idx} ->
        %{
          name: "shape_#{idx}",
          table: "level_4",
          where: where_spec.where,
          columns: ["id", "level_3_id", "value"],
          pk: ["id"],
          optimized: where_spec.optimized
        }
      end)

    run_with_shapes(ctx, shapes, mutations, opts)
  end

  @doc """
  Runs with explicit shapes and mutations.
  Useful for hand-written test cases that use the standard schema.

  Options:
    - :oracle_pool_size - number of parallel oracle connections (default: 50, env: ORACLE_POOL_SIZE)
  """
  def run_with_shapes(ctx, shapes, mutations, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

    log("Starting #{length(shapes)} shapes")

    IO.puts("\n=== SHAPES ===")

    Enum.each(shapes, fn shape ->
      IO.puts("  #{shape.name}: #{shape.where}")
    end)

    IO.puts("\n=== MUTATIONS ===")

    Enum.each(mutations, fn mutation ->
      IO.puts("  #{mutation.name}: #{mutation.sql}")
    end)

    IO.puts("")

    # Start oracle pool for parallel Postgres queries
    {:ok, oracle_pool} = start_oracle_pool(ctx, opts)

    # Create all checkers (starts StreamConsumers)
    checkers = start_checkers(ctx, shapes, oracle_pool, opts)

    log("Waiting for initial snapshot")
    checkers = await_all_up_to_date(checkers, timeout_ms, "initial snapshot")

    log("Running #{length(mutations)} mutations")

    # Get initial oracle state to pass to first mutation
    initial_oracle = query_all_oracles_parallel(checkers)

    # Pass oracle_after from each mutation as oracle_before for the next one
    # This cuts oracle queries in half since oracle_before is typically the same as previous oracle_after
    {checkers, _final_oracle} =
      Enum.reduce(mutations, {checkers, initial_oracle}, fn mutation, {checkers, prev_oracle} ->
        run_mutation_cycle(ctx, checkers, mutation, timeout_ms, prev_oracle)
      end)

    stop_checkers(checkers)
    GenServer.stop(oracle_pool)
    :ok
  end

  # ----------------------------------------------------------------------------
  # Legacy API (for backwards compatibility during transition)
  # ----------------------------------------------------------------------------

  @doc """
  Runs explicit test cases. Each case specifies its own schema, seed, shapes, and mutations.

  DEPRECATED: Prefer run_parallel/2 or run_with_shapes/4 for better performance.
  """
  def run_cases(ctx, cases, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)

    Enum.each(cases, fn case_spec ->
      run_case(ctx, case_spec, opts)
    end)
  end

  defp run_case(ctx, case_spec, opts) do
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

    log("case=#{case_spec.name}")
    apply_sql(ctx, case_spec.schema_sql)
    apply_sql(ctx, case_spec.seed_sql)

    # Start oracle pool for parallel Postgres queries
    {:ok, oracle_pool} = start_oracle_pool(ctx, opts)

    checkers = start_checkers(ctx, case_spec.shapes, oracle_pool, opts)

    Enum.each(checkers, fn checker ->
      where_display = checker.where || "true"
      log("  shape=#{checker.name} where=#{inspect(where_display)}")
    end)

    checkers = await_all_up_to_date(checkers, timeout_ms, "initial snapshot")

    # Get initial oracle state to pass to first mutation
    initial_oracle = query_all_oracles_parallel(checkers)

    # Pass oracle_after from each mutation as oracle_before for the next one
    {checkers, _final_oracle} =
      case_spec.mutations
      |> Enum.reduce({checkers, initial_oracle}, fn mutation, {checkers, prev_oracle} ->
        {checkers, oracle_after} = run_mutation_cycle(ctx, checkers, mutation, timeout_ms, prev_oracle)
        log("  mutation=#{mutation.name} PASS")
        {checkers, oracle_after}
      end)

    stop_checkers(checkers)
    GenServer.stop(oracle_pool)
  end

  # ----------------------------------------------------------------------------
  # Internal Implementation - Parallel Coordination
  # ----------------------------------------------------------------------------

  defp start_oracle_pool(ctx, opts) do
    pool_size = opts[:oracle_pool_size] || @default_oracle_pool_size

    conn_opts =
      ctx.db_config
      |> Electric.Utils.deobfuscate_password()
      |> Keyword.put(:pool_size, pool_size)
      |> Keyword.put(:types, PgInterop.Postgrex.Types)
      |> Keyword.put(:backoff_type, :stop)
      |> Keyword.put(:max_restarts, 0)

    Postgrex.start_link(conn_opts)
  end

  defp start_checkers(ctx, shapes, oracle_pool, opts) do
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

    Enum.map(shapes, fn shape ->
      ShapeChecker.new(ctx, shape, oracle_pool, timeout_ms: timeout_ms)
    end)
  end

  defp stop_checkers(checkers) do
    Enum.each(checkers, &ShapeChecker.stop/1)
  end

  # Central message handling - messages are sent to the main process,
  # so we need a central receive loop (can't parallelize this part)
  defp await_all_up_to_date(checkers, timeout_ms, step_name) do
    import ExUnit.Assertions

    pid_to_checker = Map.new(checkers, &{&1.pid, &1})
    pending = MapSet.new(Enum.map(checkers, & &1.pid))
    start_ms = System.monotonic_time(:millisecond)

    updated_checkers = do_await_all(checkers, pid_to_checker, pending, timeout_ms, start_ms)

    # Check for timeouts
    Enum.each(updated_checkers, fn checker ->
      if checker.timed_out? do
        flunk("Oracle timeout in step=#{step_name} shape=#{checker.name}")
      end
    end)

    updated_checkers
  end

  defp do_await_all(checkers, pid_to_checker, pending, timeout_ms, start_ms) do
    if MapSet.size(pending) == 0 do
      checkers
    else
      elapsed = System.monotonic_time(:millisecond) - start_ms
      remaining = max(0, timeout_ms - elapsed)

      receive do
        {:stream_message, pid, msg} ->
          case Map.get(pid_to_checker, pid) do
            nil ->
              # Unknown pid, ignore
              do_await_all(checkers, pid_to_checker, pending, timeout_ms, start_ms)

            checker ->
              {updated_checker, done?} = handle_checker_message(checker, msg)
              updated_checkers = update_checker_in_list(checkers, updated_checker)
              updated_pid_to_checker = Map.put(pid_to_checker, pid, updated_checker)
              pending = if done?, do: MapSet.delete(pending, pid), else: pending

              do_await_all(
                updated_checkers,
                updated_pid_to_checker,
                pending,
                timeout_ms,
                start_ms
              )
          end
      after
        remaining ->
          # Mark all pending checkers as timed out
          Enum.map(checkers, fn checker ->
            if MapSet.member?(pending, checker.pid) do
              %{checker | timed_out?: true}
            else
              checker
            end
          end)
      end
    end
  end

  defp handle_checker_message(checker, %Electric.Client.Message.ChangeMessage{} = msg) do
    updated = ShapeChecker.apply_message(checker, msg)
    {updated, false}
  end

  defp handle_checker_message(checker, %Electric.Client.Message.ControlMessage{
         control: :up_to_date
       }) do
    {checker, true}
  end

  defp handle_checker_message(checker, %Electric.Client.Message.ControlMessage{
         control: :must_refetch
       }) do
    updated = %{checker | rows: %{}, must_refetch?: true}
    {updated, false}
  end

  defp handle_checker_message(checker, %Electric.Client.Error{} = error) do
    updated = %{checker | error: error}
    {updated, true}
  end

  defp handle_checker_message(checker, _msg) do
    {checker, false}
  end

  defp update_checker_in_list(checkers, updated_checker) do
    Enum.map(checkers, fn checker ->
      if checker.pid == updated_checker.pid, do: updated_checker, else: checker
    end)
  end

  defp run_mutation_cycle(ctx, checkers, mutation, timeout_ms, oracle_before) do
    # Phase 1: Apply mutation
    apply_sql(ctx, mutation.sql)

    # Phase 2: Wait for all clients to be up_to_date (central receive loop)
    checkers = await_all_up_to_date(checkers, timeout_ms, mutation.name)

    # Phase 3: Query oracle_after and verify in parallel
    # Returns {checkers, oracle_after} so oracle_after can be reused as next oracle_before
    verify_all_parallel(checkers, mutation, oracle_before)
  end

  defp query_all_oracles_parallel(checkers) do
    checkers
    |> Task.async_stream(
      fn checker -> {checker.name, ShapeChecker.query_oracle(checker)} end,
      max_concurrency: length(checkers),
      ordered: false
    )
    |> Enum.into(%{}, fn {:ok, {name, rows}} -> {name, rows} end)
  end

  defp verify_all_parallel(checkers, mutation, oracle_before) do
    results =
      checkers
      |> Task.async_stream(
        fn checker ->
          oracle_after = ShapeChecker.query_oracle(checker)

          ShapeChecker.assert_consistent!(
            checker,
            mutation.name,
            oracle_before[checker.name],
            oracle_after
          )

          {checker, oracle_after}
        end,
        max_concurrency: length(checkers),
        timeout: 30_000,
        on_timeout: :kill_task
      )
      |> Enum.map(fn
        {:ok, {checker, oracle_after}} ->
          {checker, oracle_after}

        {:exit, :timeout} ->
          import ExUnit.Assertions
          flunk("Oracle query timeout in mutation=#{mutation.name}")

        {:exit, reason} ->
          import ExUnit.Assertions
          flunk("Checker failed in mutation=#{mutation.name}: #{inspect(reason)}")
      end)

    checkers = Enum.map(results, fn {checker, _oracle} -> checker end)
    oracle_after = Map.new(results, fn {checker, oracle} -> {checker.name, oracle} end)
    {checkers, oracle_after}
  end

  # ----------------------------------------------------------------------------
  # Helpers
  # ----------------------------------------------------------------------------

  defp apply_sql(_ctx, nil), do: :ok
  defp apply_sql(ctx, sql) when is_list(sql), do: Enum.each(sql, &apply_sql(ctx, &1))

  defp apply_sql(ctx, sql) when is_binary(sql) do
    Postgrex.query!(ctx.db_conn, sql, [])
  end

  defp env_int(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.to_integer(value)
    end
  end

  defp log(message) do
    IO.puts("[oracle] #{message}")
  end
end
