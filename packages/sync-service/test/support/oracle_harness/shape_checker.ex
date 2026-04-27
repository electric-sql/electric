defmodule Support.OracleHarness.ShapeChecker do
  @moduledoc """
  GenServer that verifies a single shape's consistency with the Postgres oracle.

  Each checker:
  - Maintains its own materialized view from Electric shape changes
  - Queries the oracle (Postgres) via a shared pool
  - Verifies consistency between materialized client state and oracle

  ## Usage

      {:ok, pid} = ShapeChecker.start_link(ctx, shape, oracle_pool, timeout_ms: 10_000)

      # Check initial snapshot matches oracle
      ShapeChecker.check_initial_state(pid)

      # After mutations, check transaction result matches oracle
      ShapeChecker.check_transaction(pid, "txn_1")

  """

  use GenServer

  import ExUnit.Assertions

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.ShapeState

  defstruct [
    :name,
    :table,
    :where,
    :columns,
    :pk,
    :optimized,
    :client,
    :shape_def,
    :oracle_pool,
    :timeout_ms,
    poll_state: nil,
    rows: %{},
    # Cached oracle state from previous check (used as "before" for next check)
    oracle_before: nil
  ]

  # ---------------------------------------------------------------------------
  # Public API
  # ---------------------------------------------------------------------------

  @doc """
  Starts a ShapeChecker GenServer.
  """
  def start_link(ctx, shape, oracle_pool, opts \\ []) do
    GenServer.start_link(__MODULE__, {ctx, shape, oracle_pool, opts})
  end

  @doc """
  Checks the initial state: queries oracle, polls shape until up_to_date,
  and verifies they match. Caches oracle state for subsequent transaction checks.

  Raises on mismatch or timeout.
  """
  def check_initial_state(pid) do
    GenServer.call(pid, :check_initial_state, :infinity)
  end

  @doc """
  Checks after a transaction: polls shape until up_to_date, queries oracle,
  and verifies they match. Uses cached "before" state for logging.

  Raises on mismatch or timeout.
  """
  def check_transaction(pid, txn_name) do
    GenServer.call(pid, {:check_transaction, txn_name}, :infinity)
  end

  # ---------------------------------------------------------------------------
  # GenServer Callbacks
  # ---------------------------------------------------------------------------

  @impl true
  def init({ctx, shape, oracle_pool, opts}) do
    validate_identifier!(shape.table, "table")
    Enum.each(shape.columns, &validate_identifier!(&1, "column"))
    Enum.each(shape.pk, &validate_identifier!(&1, "pk column"))

    shape_def = ShapeDefinition.new!(shape.table, where: shape.where)
    timeout_ms = Keyword.fetch!(opts, :timeout_ms)

    state = %__MODULE__{
      name: shape.name,
      table: shape.table,
      where: shape.where,
      columns: shape.columns,
      pk: shape.pk,
      optimized: Map.get(shape, :optimized, false),
      client: ctx.client,
      shape_def: shape_def,
      oracle_pool: oracle_pool,
      timeout_ms: timeout_ms,
      poll_state: ShapeState.new()
    }

    {:ok, state}
  end

  @impl true
  def handle_call(:check_initial_state, _from, state) do
    log("Checking initial state for shape=#{state.name}")

    # Get oracle state (this becomes our "before" for the first transaction)
    oracle = query_oracle(state)

    # Poll until up_to_date
    state = await_up_to_date(state)

    # Verify consistency
    assert_consistent!(state, "initial_snapshot", oracle, oracle)

    # Cache oracle state for next check
    state = %{state | oracle_before: oracle}

    {:reply, :ok, state}
  end

  @impl true
  def handle_call({:check_transaction, txn_name}, _from, state) do
    # Poll until up_to_date
    state = await_up_to_date(state)

    # Get new oracle state
    oracle_after = query_oracle(state)

    # Verify consistency (uses cached oracle_before)
    assert_consistent!(state, txn_name, state.oracle_before, oracle_after)

    # Cache new oracle state for next check
    state = %{state | oracle_before: oracle_after}

    {:reply, :ok, state}
  end

  # ---------------------------------------------------------------------------
  # Polling Logic
  # ---------------------------------------------------------------------------

  defp await_up_to_date(state) do
    do_await(state, System.monotonic_time(:millisecond))
  end

  defp do_await(state, start_ms) do
    elapsed = System.monotonic_time(:millisecond) - start_ms

    if elapsed >= state.timeout_ms do
      # Timed out — return state and let assert_consistent! report the mismatch
      state
    else
      case Client.poll(state.client, state.shape_def, state.poll_state, replica: :full) do
        {:ok, messages, new_state} ->
          state = %{state | poll_state: new_state}
          state = apply_messages(state, messages)

          if new_state.up_to_date? do
            handle_up_to_date(state, start_ms)
          else
            do_await(state, start_ms)
          end

        {:must_refetch, messages, new_state} ->
          if state.optimized do
            flunk(
              "Unexpected 409 (must-refetch) in optimized shape=#{state.name} where=#{state.where}"
            )
          end

          state = %{state | poll_state: new_state, rows: %{}}
          state = apply_messages(state, messages)
          do_await(state, start_ms)

        {:error, error} ->
          flunk("Poll error for shape=#{state.name} where=#{state.where}: #{inspect(error)}")
      end
    end
  end

  defp handle_up_to_date(state, start_ms) do
    oracle_rows = query_oracle(state)
    materialized = materialized_rows(state)

    if materialized == oracle_rows do
      state
    else
      # Electric reported up_to_date but data doesn't match yet - keep polling
      do_await(state, start_ms)
    end
  end

  # ---------------------------------------------------------------------------
  # Message Application
  # ---------------------------------------------------------------------------

  defp apply_messages(state, messages) do
    Enum.reduce(messages, state, &apply_message/2)
  end

  defp apply_message(%ChangeMessage{headers: %{operation: :insert}, value: value}, state) do
    key = key_from_value(state.pk, value)

    if Map.has_key?(state.rows, key) do
      flunk("shape=#{state.name}: insert for row that already exists: #{inspect(key)}")
    end

    row = Map.take(value, state.columns)
    %{state | rows: Map.put(state.rows, key, row)}
  end

  defp apply_message(%ChangeMessage{headers: %{operation: :update}, value: value}, state) do
    key = key_from_value(state.pk, value)

    if not Map.has_key?(state.rows, key) do
      flunk("shape=#{state.name}: update for row that does not exist: #{inspect(key)}")
    end

    row = Map.take(value, state.columns)
    %{state | rows: Map.put(state.rows, key, row)}
  end

  defp apply_message(%ChangeMessage{headers: %{operation: :delete}, value: value}, state) do
    key = key_from_value(state.pk, value)

    if not Map.has_key?(state.rows, key) do
      flunk("shape=#{state.name}: delete for row that does not exist: #{inspect(key)}")
    end

    %{state | rows: Map.delete(state.rows, key)}
  end

  defp apply_message(%ControlMessage{}, state), do: state
  defp apply_message(_other, state), do: state

  defp key_from_value(pk, value) do
    pk
    |> Enum.map(&Map.get(value, &1))
    |> List.to_tuple()
  end

  # ---------------------------------------------------------------------------
  # Oracle Queries
  # ---------------------------------------------------------------------------

  defp query_oracle(state) do
    where_sql = state.where || "TRUE"
    columns_sql = Enum.map(state.columns, &quote_ident/1) |> Enum.join(", ")
    order_sql = Enum.map(state.pk, &quote_ident/1) |> Enum.join(", ")

    sql =
      "SELECT #{columns_sql} FROM #{quote_ident(state.table)} WHERE #{where_sql} ORDER BY #{order_sql}"

    %Postgrex.Result{columns: columns, rows: rows} =
      Postgrex.query!(state.oracle_pool, sql, [])

    Enum.map(rows, fn row ->
      columns
      |> Enum.zip(row)
      |> Map.new(fn {col, val} -> {col, to_string_value(val)} end)
    end)
  end

  # ---------------------------------------------------------------------------
  # Assertions
  # ---------------------------------------------------------------------------

  defp assert_consistent!(state, step_name, oracle_before, oracle_after) do
    view_changed? = oracle_before != oracle_after
    materialized = materialized_rows(state)

    if materialized != oracle_after do
      IO.puts(
        "[oracle] View mismatch in step=#{step_name} shape=#{state.name} where=#{state.where} view_changed?=#{view_changed?}"
      )

      assert materialized == oracle_after
    end

    view_status = if view_changed?, do: "changed", else: "unchanged"
    log("  #{step_name} shape=#{state.name} (#{view_status}) PASS")

    :ok
  end

  defp materialized_rows(state) do
    state.rows
    |> Map.values()
    |> Enum.sort_by(&key_from_value(state.pk, &1))
  end

  # ---------------------------------------------------------------------------
  # Helpers
  # ---------------------------------------------------------------------------

  defp validate_identifier!(value, label) do
    if String.match?(value, ~r/^[A-Za-z_][A-Za-z0-9_]*$/) do
      :ok
    else
      raise ArgumentError, "invalid #{label} identifier: #{inspect(value)}"
    end
  end

  defp quote_ident(value), do: ~s|"#{value}"|

  defp to_string_value(nil), do: nil
  defp to_string_value(true), do: "true"
  defp to_string_value(false), do: "false"
  defp to_string_value(val) when is_binary(val), do: val
  defp to_string_value(val), do: to_string(val)

  defp log(message) do
    IO.puts("[oracle] #{message}")
  end
end
