defmodule Support.OracleHarness.ShapeChecker do
  @moduledoc """
  Per-shape checker that uses polling to verify consistency with the oracle.

  Each checker:
  - Uses Electric.Client.poll/4 to fetch shape changes
  - Queries the oracle (Postgres) via a shared pool
  - Verifies consistency between materialized client state and oracle
  """

  import ExUnit.Assertions

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.ShapeDefinition
  alias Electric.Client.ShapeState

  # Max time to wait for changes after receiving up_to_date without changes (in ms)
  # This handles the case where LONG_POLL_TIMEOUT is short and Electric hasn't
  # processed changes yet.
  @default_retry_window_ms 5_000

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
    poll_state: nil,
    rows: %{},
    must_refetch?: false,
    error: nil,
    timed_out?: false,
    # Track if we received any changes during current await cycle
    got_changes?: false,
    # When we started retrying due to oracle mismatch
    retry_start_ms: nil
  ]

  @doc """
  Creates a new checker for a shape.
  """
  def new(ctx, shape, oracle_pool, _opts \\ []) do
    validate_identifier!(shape.table, "table")
    Enum.each(shape.columns, &validate_identifier!(&1, "column"))
    Enum.each(shape.pk, &validate_identifier!(&1, "pk column"))

    shape_def = ShapeDefinition.new!(shape.table, where: shape.where)

    %__MODULE__{
      name: shape.name,
      table: shape.table,
      where: shape.where,
      columns: shape.columns,
      pk: shape.pk,
      optimized: Map.get(shape, :optimized, false),
      client: ctx.client,
      shape_def: shape_def,
      oracle_pool: oracle_pool,
      poll_state: ShapeState.new()
    }
  end

  @doc """
  Query the oracle (Postgres) for the expected rows for this shape.
  Uses the shared oracle pool for parallel queries across shapes.
  """
  def query_oracle(%__MODULE__{} = checker) do
    where_sql = checker.where || "TRUE"
    columns_sql = Enum.map(checker.columns, &quote_ident/1) |> Enum.join(", ")
    order_sql = Enum.map(checker.pk, &quote_ident/1) |> Enum.join(", ")

    sql =
      "SELECT #{columns_sql} FROM #{quote_ident(checker.table)} WHERE #{where_sql} ORDER BY #{order_sql}"

    %Postgrex.Result{columns: columns, rows: rows} =
      Postgrex.query!(checker.oracle_pool, sql, [])

    Enum.map(rows, fn row ->
      columns
      |> Enum.zip(row)
      |> Map.new(fn {col, val} -> {col, to_string_value(val)} end)
    end)
  end

  @doc """
  Wait for up_to_date control message and return updated checker with all applied changes.
  Uses polling instead of a stream consumer.

  Includes retry logic to handle the case where LONG_POLL_TIMEOUT is short and
  Electric hasn't processed all changes yet. When up_to_date is received without
  changes, we check if the oracle matches the materialized state. If not, we
  retry polling for up to @default_retry_window_ms.
  """
  def await_up_to_date(%__MODULE__{} = checker, timeout_ms) do
    checker = reset_events(checker)
    do_await(checker, timeout_ms, System.monotonic_time(:millisecond))
  end

  defp do_await(checker, timeout_ms, start_ms) do
    elapsed = System.monotonic_time(:millisecond) - start_ms

    if elapsed >= timeout_ms do
      %{checker | timed_out?: true}
    else
      case Client.poll(checker.client, checker.shape_def, checker.poll_state, replica: :full) do
        {:ok, messages, new_state} ->
          got_changes? = checker.got_changes? or has_change_messages?(messages)
          checker = %{checker | poll_state: new_state, got_changes?: got_changes?}
          checker = apply_messages(checker, messages)

          cond do
            # Still fetching snapshot
            not new_state.up_to_date? ->
              do_await(checker, timeout_ms, start_ms)

            # Up to date - check if oracle matches (might need more changes)
            true ->
              handle_up_to_date(checker, timeout_ms, start_ms)
          end

        {:must_refetch, messages, new_state} ->
          checker = %{checker | poll_state: new_state, rows: %{}, must_refetch?: true, got_changes?: false, retry_start_ms: nil}
          checker = apply_messages(checker, messages)
          do_await(checker, timeout_ms, start_ms)

        {:error, error} ->
          %{checker | error: error}
      end
    end
  end

  defp has_change_messages?(messages) do
    Enum.any?(messages, &match?(%ChangeMessage{}, &1))
  end

  defp handle_up_to_date(checker, timeout_ms, start_ms) do
    now = System.monotonic_time(:millisecond)
    oracle_rows = query_oracle(checker)
    materialized = materialized_rows(checker)

    if materialized == oracle_rows do
      # Oracle matches - we have all the expected data
      checker
    else
      # Oracle differs - Electric hasn't sent all changes yet
      # Start or continue retry window
      retry_start = checker.retry_start_ms || now

      if now - retry_start >= @default_retry_window_ms do
        # Exceeded retry window - give up (will fail in verify step)
        checker
      else
        # Continue retrying - reset got_changes? so we keep polling
        checker = %{checker | retry_start_ms: retry_start, got_changes?: false}
        do_await(checker, timeout_ms, start_ms)
      end
    end
  end

  defp apply_messages(checker, messages) do
    Enum.reduce(messages, checker, fn msg, acc ->
      apply_message(acc, msg)
    end)
  end

  @doc """
  Apply a message to update the checker's materialized rows.
  """
  def apply_message(checker, %ChangeMessage{} = msg) do
    apply_change(checker, msg)
  end

  def apply_message(checker, %ControlMessage{}) do
    checker
  end

  def apply_message(checker, _other) do
    checker
  end

  defp reset_events(checker) do
    %{checker | must_refetch?: false, error: nil, timed_out?: false, got_changes?: false, retry_start_ms: nil}
  end

  defp apply_change(checker, %ChangeMessage{headers: %{operation: :delete}, value: value}) do
    key = key_from_value(checker.pk, value)
    %{checker | rows: Map.delete(checker.rows, key)}
  end

  defp apply_change(checker, %ChangeMessage{value: value}) do
    key = key_from_value(checker.pk, value)
    row = Map.take(value, checker.columns)
    %{checker | rows: Map.put(checker.rows, key, row)}
  end

  defp key_from_value(pk, value) do
    pk
    |> Enum.map(&Map.get(value, &1))
    |> List.to_tuple()
  end

  @doc """
  Assert this shape is consistent with oracle.
  Raises on mismatch, error, or timeout.
  Returns :ok on success.
  """
  def assert_consistent!(checker, mutation_name, oracle_before, oracle_after) do
    view_changed? = oracle_before != oracle_after

    if checker.error do
      flunk(
        "Oracle error in step=#{mutation_name} shape=#{checker.name} where=#{checker.where} error=#{inspect(checker.error)}"
      )
    end

    if checker.timed_out? do
      flunk(
        "Timeout waiting for shape=#{checker.name} in step=#{mutation_name} where=#{checker.where}"
      )
    end

    if checker.optimized and checker.must_refetch? do
      flunk(
        "Unexpected 409 (must-refetch) in optimized shape step=#{mutation_name} shape=#{checker.name} where=#{checker.where}"
      )
    end

    materialized = materialized_rows(checker)

    if materialized != oracle_after do
      flunk(
        "View mismatch in step=#{mutation_name} shape=#{checker.name} where=#{checker.where} view_changed?=#{view_changed?}\n" <>
          "  materialized: #{inspect(materialized)}\n" <>
          "  oracle:       #{inspect(oracle_after)}"
      )
    end

    view_status = if view_changed?, do: "changed", else: "unchanged"
    log("  #{mutation_name} shape=#{checker.name} (#{view_status}) PASS")

    :ok
  end

  @doc """
  Get the materialized rows sorted by primary key.
  """
  def materialized_rows(%__MODULE__{} = checker) do
    checker.rows
    |> Map.values()
    |> Enum.sort_by(&key_from_value(checker.pk, &1))
  end

  @doc """
  Stop the checker. No-op with polling (no background process).
  """
  def stop(%__MODULE__{}) do
    :ok
  end

  # Private helpers

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

  defp to_string_value(nil), do: nil
  defp to_string_value(true), do: "true"
  defp to_string_value(false), do: "false"
  defp to_string_value(val) when is_binary(val), do: val
  defp to_string_value(val), do: to_string(val)

  defp log(message) do
    IO.puts("[oracle] #{message}")
  end
end
