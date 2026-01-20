defmodule Support.OracleHarness do
  @moduledoc """
  Harness for comparing Electric shape streams against Postgres query results.
  """

  import ExUnit.Assertions

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.ShapeDefinition
  alias Support.StreamConsumer

  @default_timeout_ms 20_000

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

  def default_opts_from_env do
    %{
      case_limit: env_int("ELECTRIC_ORACLE_CASE_LIMIT"),
      case_names: env_list("ELECTRIC_ORACLE_CASES"),
      mutation_limit: env_int("ELECTRIC_ORACLE_MUTATION_LIMIT"),
      shape_limit: env_int("ELECTRIC_ORACLE_SHAPE_LIMIT"),
      timeout_ms: env_int("ELECTRIC_ORACLE_TIMEOUT_MS") || @default_timeout_ms
    }
  end

  def run_cases(ctx, cases, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)
    cases = filter_cases(cases, opts)

    Enum.each(cases, fn case_spec ->
      run_case(ctx, case_spec, opts)
    end)
  end

  defp run_case(ctx, case_spec, opts) do
    apply_sql(ctx, case_spec.schema_sql)
    apply_sql(ctx, case_spec.seed_sql)

    {states, pid_map} = start_shapes(ctx, case_spec.shapes, opts)

    states = await_up_to_date(states, pid_map, opts.timeout_ms, case_spec, "initial snapshot")

    case_spec.mutations
    |> limit_list(opts.mutation_limit)
    |> Enum.reduce(states, fn mutation, states ->
      oracle_before = oracle_snapshot(ctx, states)
      apply_sql(ctx, mutation.sql)
      states = await_up_to_date(states, pid_map, opts.timeout_ms, case_spec, mutation.name)
      oracle_after = oracle_snapshot(ctx, states)
      assert_consistent(case_spec, mutation, states, oracle_before, oracle_after)
      states
    end)

    stop_shapes(states)
  end

  defp start_shapes(ctx, shapes, opts) do
    shapes =
      shapes
      |> limit_list(opts.shape_limit)
      |> Enum.map(fn shape ->
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

  defp await_up_to_date(states, pid_map, timeout_ms, case_spec, step_name) do
    states = Enum.map(states, &reset_events/1)
    pending = MapSet.new(Enum.map(states, & &1.pid))
    start_ms = System.monotonic_time(:millisecond)

    do_await(states, pid_map, pending, timeout_ms, start_ms, case_spec, step_name)
  end

  defp do_await(states, pid_map, pending, timeout_ms, start_ms, case_spec, step_name) do
    if MapSet.size(pending) == 0 do
      states
    else
    elapsed = System.monotonic_time(:millisecond) - start_ms
    remaining = max(0, timeout_ms - elapsed)

    receive do
      {:stream_message, pid, msg} ->
        case Map.get(pid_map, pid) do
          nil ->
            do_await(states, pid_map, pending, timeout_ms, start_ms, case_spec, step_name)

          _name ->
            {states, pending} = handle_message(states, pending, pid, msg)
            do_await(states, pid_map, pending, timeout_ms, start_ms, case_spec, step_name)
        end
    after
      remaining ->
        mark_timeouts(states, pending, case_spec, step_name)
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

  defp mark_timeouts(states, pending, case_spec, step_name) do
    Enum.map(states, fn state ->
      if MapSet.member?(pending, state.pid) do
        state = put_in(state.events.timed_out?, true)

        flunk(
          "Oracle timeout in case=#{case_spec.name} step=#{step_name} shape=#{state.name}"
        )

        state
      else
        state
      end
    end)
  end

  defp reset_events(state) do
    %{state | events: %{change_count: 0, up_to_date?: false, must_refetch?: false, error: nil, timed_out?: false}}
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

    Enum.map(rows, fn row ->
      columns |> Enum.zip(row) |> Map.new()
    end)
  end

  defp assert_consistent(case_spec, mutation, states, oracle_before, oracle_after) do
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

  defp limit_list(list, nil), do: list
  defp limit_list(list, limit), do: Enum.take(list, limit)

  defp env_int(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.to_integer(value)
    end
  end

  defp env_list(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.split(value, ",", trim: true)
    end
  end

  defp filter_cases(cases, opts) do
    cases =
      case opts.case_names do
        nil -> cases
        names -> Enum.filter(cases, &(&1.name in names))
      end

    limit_list(cases, opts.case_limit)
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
end
