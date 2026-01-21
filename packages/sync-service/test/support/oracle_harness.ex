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

  import ExUnit.Assertions

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.ShapeDefinition
  alias Support.StreamConsumer

  @default_timeout_ms 20_000
  @default_shape_count 100
  @default_mutation_count 20

  # Standard IDs for seeded data
  @level_1_ids Enum.map(1..5, &"l1-#{&1}")
  @level_2_ids Enum.map(1..5, &"l2-#{&1}")
  @level_3_ids Enum.map(1..5, &"l3-#{&1}")
  @level_4_ids Enum.map(1..20, &"l4-#{&1}")
  @tags ["alpha", "beta", "gamma", "delta"]

  defmodule ShapeState do
    @moduledoc false
    defstruct [
      :name,
      :table,
      :where,
      :columns,
      :pk,
      :optimized,
      :consumer,
      :pid,
      rows: %{},
      events: %{
        change_count: 0,
        up_to_date?: false,
        must_refetch?: false,
        error: nil,
        timed_out?: false
      }
    ]
  end

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
    %{name: "update_l4_#{id}", sql: "UPDATE level_4 SET value = '#{new_value}' WHERE id = '#{id}'"}
  end

  # ----------------------------------------------------------------------------
  # Main Test Runner
  # ----------------------------------------------------------------------------

  def default_opts_from_env do
    %{
      shape_count: env_int("ELECTRIC_ORACLE_SHAPE_COUNT") || @default_shape_count,
      mutation_count: env_int("ELECTRIC_ORACLE_MUTATION_COUNT") || @default_mutation_count,
      timeout_ms: env_int("ELECTRIC_ORACLE_TIMEOUT_MS") || @default_timeout_ms,
      where_seed: env_int("ELECTRIC_ORACLE_WHERE_SEED"),
      mutation_seed: env_int("ELECTRIC_ORACLE_MUTATION_SEED"),
      verbose: System.get_env("ELECTRIC_ORACLE_VERBOSE") == "1"
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

    where_clauses = generate_where_clauses(opts.shape_count, opts.where_seed)
    mutations = generate_mutations(opts.mutation_count, opts.mutation_seed)

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
  """
  def run_with_shapes(ctx, shapes, mutations, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)

    log(opts, "Starting #{length(shapes)} shapes")

    if opts[:verbose] do
      IO.puts("\n=== SHAPES ===")

      Enum.each(shapes, fn shape ->
        IO.puts("  #{shape.name}: #{shape.where}")
      end)

      IO.puts("\n=== MUTATIONS ===")

      Enum.each(mutations, fn mutation ->
        IO.puts("  #{mutation.name}: #{mutation.sql}")
      end)

      IO.puts("")
    end

    {states, pid_map} = start_shapes(ctx, shapes, opts)

    log(opts, "Waiting for initial snapshot")
    states = await_up_to_date(states, pid_map, opts.timeout_ms, "parallel", "initial snapshot")

    log(opts, "Running #{length(mutations)} mutations")

    Enum.reduce(mutations, states, fn mutation, states ->
      oracle_before = oracle_snapshot(ctx, states)
      apply_sql(ctx, mutation.sql)
      states = await_up_to_date(states, pid_map, opts.timeout_ms, "parallel", mutation.name)
      oracle_after = oracle_snapshot(ctx, states)
      assert_all_consistent(mutation, states, oracle_before, oracle_after, opts)
      states
    end)

    stop_shapes(states)
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
    log(opts, "case=#{case_spec.name}")
    apply_sql(ctx, case_spec.schema_sql)
    apply_sql(ctx, case_spec.seed_sql)

    {states, pid_map} = start_shapes(ctx, case_spec.shapes, opts)

    Enum.each(states, fn state ->
      where_display = state.where || "true"
      log(opts, "  shape=#{state.name} where=#{inspect(where_display)}")
    end)

    states = await_up_to_date(states, pid_map, opts.timeout_ms, case_spec.name, "initial snapshot")

    case_spec.mutations
    |> Enum.reduce(states, fn mutation, states ->
      oracle_before = oracle_snapshot(ctx, states)
      apply_sql(ctx, mutation.sql)
      states = await_up_to_date(states, pid_map, opts.timeout_ms, case_spec.name, mutation.name)
      oracle_after = oracle_snapshot(ctx, states)
      assert_case_consistent(case_spec, mutation, states, oracle_before, oracle_after)
      view_changed? = oracle_before != oracle_after
      view_status = if view_changed?, do: "view changed", else: "view unchanged"
      log(opts, "  mutation=#{mutation.name} (#{view_status}) PASS")
      states
    end)

    stop_shapes(states)
  end

  # ----------------------------------------------------------------------------
  # Internal Implementation
  # ----------------------------------------------------------------------------

  defp start_shapes(ctx, shapes, opts) do
    shapes =
      Enum.map(shapes, fn shape ->
        validate_identifier!(shape.table, "table")
        Enum.each(shape.columns, &validate_identifier!(&1, "column"))
        Enum.each(shape.pk, &validate_identifier!(&1, "pk column"))

        shape_def = ShapeDefinition.new!(shape.table, where: shape.where)

        stream =
          Client.stream(ctx.client, shape_def,
            live: true,
            replica: :full,
            errors: :stream
          )

        {:ok, consumer} = StreamConsumer.start(stream, timeout: opts.timeout_ms)

        %ShapeState{
          name: shape.name,
          table: shape.table,
          where: shape.where,
          columns: shape.columns,
          pk: shape.pk,
          optimized: Map.get(shape, :optimized, false),
          consumer: consumer,
          pid: consumer.task_pid
        }
      end)

    pid_map = Map.new(shapes, &{&1.pid, &1.name})
    {shapes, pid_map}
  end

  defp stop_shapes(states) do
    Enum.each(states, fn state ->
      StreamConsumer.stop(state.consumer)
    end)
  end

  defp await_up_to_date(states, pid_map, timeout_ms, case_name, step_name) do
    states = Enum.map(states, &reset_events/1)
    pending = MapSet.new(Enum.map(states, & &1.pid))
    start_ms = System.monotonic_time(:millisecond)

    do_await(states, pid_map, pending, timeout_ms, start_ms, case_name, step_name)
  end

  defp do_await(states, pid_map, pending, timeout_ms, start_ms, case_name, step_name) do
    if MapSet.size(pending) == 0 do
      states
    else
      elapsed = System.monotonic_time(:millisecond) - start_ms
      remaining = max(0, timeout_ms - elapsed)

      receive do
        {:stream_message, pid, msg} ->
          case Map.get(pid_map, pid) do
            nil ->
              do_await(states, pid_map, pending, timeout_ms, start_ms, case_name, step_name)

            _name ->
              {states, pending} = handle_message(states, pending, pid, msg)
              do_await(states, pid_map, pending, timeout_ms, start_ms, case_name, step_name)
          end
      after
        remaining ->
          mark_timeouts(states, pending, case_name, step_name)
      end
    end
  end

  defp handle_message(states, pending, pid, %ChangeMessage{} = msg) do
    states =
      Enum.map(states, fn state ->
        if state.pid == pid do
          state
          |> apply_change(msg)
          |> increment_change()
        else
          state
        end
      end)

    {states, pending}
  end

  defp handle_message(states, pending, pid, %ControlMessage{control: :up_to_date}) do
    states =
      Enum.map(states, fn state ->
        if state.pid == pid do
          put_in(state.events.up_to_date?, true)
        else
          state
        end
      end)

    {states, MapSet.delete(pending, pid)}
  end

  defp handle_message(states, pending, pid, %ControlMessage{control: :must_refetch}) do
    states =
      Enum.map(states, fn state ->
        if state.pid == pid do
          state
          |> put_in([Access.key(:events), :must_refetch?], true)
          |> Map.put(:rows, %{})
        else
          state
        end
      end)

    {states, pending}
  end

  defp handle_message(states, pending, pid, %Client.Error{} = error) do
    states =
      Enum.map(states, fn state ->
        if state.pid == pid do
          put_in(state.events.error, error)
        else
          state
        end
      end)

    {states, MapSet.delete(pending, pid)}
  end

  defp handle_message(states, pending, _pid, _msg) do
    {states, pending}
  end

  defp mark_timeouts(states, pending, case_name, step_name) do
    pending_names =
      states
      |> Enum.filter(&MapSet.member?(pending, &1.pid))
      |> Enum.map(& &1.name)
      |> Enum.take(10)

    flunk(
      "Oracle timeout in case=#{case_name} step=#{step_name} pending_shapes=#{inspect(pending_names)} (#{MapSet.size(pending)} total)"
    )

    states
  end

  defp reset_events(state) do
    %{
      state
      | events: %{
          change_count: 0,
          up_to_date?: false,
          must_refetch?: false,
          error: nil,
          timed_out?: false
        }
    }
  end

  defp increment_change(state) do
    update_in(state.events.change_count, &(&1 + 1))
  end

  defp apply_change(state, %ChangeMessage{headers: %{operation: :delete}, value: value}) do
    key = key_from_value(state.pk, value)
    %{state | rows: Map.delete(state.rows, key)}
  end

  defp apply_change(state, %ChangeMessage{value: value}) do
    key = key_from_value(state.pk, value)
    row = Map.take(value, state.columns)
    %{state | rows: Map.put(state.rows, key, row)}
  end

  defp key_from_value(pk, value) do
    pk
    |> Enum.map(&Map.get(value, &1))
    |> List.to_tuple()
  end

  defp oracle_snapshot(ctx, states) do
    Map.new(states, fn state ->
      {state.name, query_oracle(ctx.db_conn, state)}
    end)
  end

  defp query_oracle(conn, state) do
    where_sql = state.where || "TRUE"
    columns_sql = Enum.map(state.columns, &quote_ident/1) |> Enum.join(", ")
    order_sql = Enum.map(state.pk, &quote_ident/1) |> Enum.join(", ")

    sql =
      "SELECT #{columns_sql} FROM #{quote_ident(state.table)} WHERE #{where_sql} ORDER BY #{order_sql}"

    %Postgrex.Result{columns: columns, rows: rows} = Postgrex.query!(conn, sql, [])

    # Convert all values to strings to match Electric's string-based output
    Enum.map(rows, fn row ->
      columns
      |> Enum.zip(row)
      |> Map.new(fn {col, val} -> {col, to_string_value(val)} end)
    end)
  end

  defp to_string_value(nil), do: nil
  defp to_string_value(true), do: "true"
  defp to_string_value(false), do: "false"
  defp to_string_value(val) when is_binary(val), do: val
  defp to_string_value(val), do: to_string(val)

  defp assert_all_consistent(mutation, states, oracle_before, oracle_after, opts) do
    Enum.each(states, fn state ->
      view_changed? = oracle_before[state.name] != oracle_after[state.name]

      if state.events.error do
        flunk(
          "Oracle error in step=#{mutation.name} shape=#{state.name} where=#{state.where} error=#{inspect(state.events.error)}"
        )
      end

      if state.optimized and state.events.must_refetch? do
        flunk(
          "Unexpected 409 (must-refetch) in optimized shape step=#{mutation.name} shape=#{state.name} where=#{state.where}"
        )
      end

      materialized = materialized_rows(state)
      oracle_view = oracle_after[state.name]

      if materialized != oracle_view do
        flunk(
          "View mismatch in step=#{mutation.name} shape=#{state.name} where=#{state.where} view_changed?=#{view_changed?}\n" <>
            "  materialized: #{inspect(materialized)}\n" <>
            "  oracle:       #{inspect(oracle_view)}"
        )
      end

      view_status = if view_changed?, do: "changed", else: "unchanged"
      log(opts, "  #{mutation.name} shape=#{state.name} (#{view_status}) PASS")
    end)
  end

  defp assert_case_consistent(case_spec, mutation, states, oracle_before, oracle_after) do
    Enum.each(states, fn state ->
      view_changed? = oracle_before[state.name] != oracle_after[state.name]

      if state.events.error do
        flunk(
          "Oracle error in case=#{case_spec.name} step=#{mutation.name} shape=#{state.name} error=#{inspect(state.events.error)}"
        )
      end

      if state.optimized and state.events.must_refetch? do
        flunk(
          "Unexpected 409 (must-refetch) in optimized shape case=#{case_spec.name} step=#{mutation.name} shape=#{state.name}"
        )
      end

      materialized = materialized_rows(state)
      oracle_view = oracle_after[state.name]

      if materialized != oracle_view do
        flunk(
          "View mismatch in case=#{case_spec.name} step=#{mutation.name} shape=#{state.name} view_changed?=#{view_changed?}"
        )
      end
    end)
  end

  defp materialized_rows(state) do
    state.rows
    |> Map.values()
    |> Enum.sort_by(&key_from_value(state.pk, &1))
  end

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

  defp validate_identifier!(value, label) do
    if String.match?(value, ~r/^[A-Za-z_][A-Za-z0-9_]*$/) do
      :ok
    else
      raise ArgumentError, "invalid #{label} identifier: #{inspect(value)}"
    end
  end

  defp quote_ident(value) do
    ~s|"#{value}"|
  end

  defp log(opts, message) do
    if opts.verbose, do: IO.puts("[oracle] #{message}")
  end
end
