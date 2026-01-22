defmodule Support.OracleHarness.ShapeChecker do
  @moduledoc """
  Per-shape checker that owns its StreamConsumer and handles verification independently.

  Each checker:
  - Owns its Electric client stream consumer
  - Receives messages from its consumer only
  - Queries the oracle (Postgres) via a shared pool
  - Verifies consistency between materialized client state and oracle
  """

  import ExUnit.Assertions

  alias Electric.Client
  alias Electric.Client.Message.ChangeMessage
  alias Electric.Client.Message.ControlMessage
  alias Electric.Client.ShapeDefinition
  alias Support.StreamConsumer

  defstruct [
    :name,
    :table,
    :where,
    :columns,
    :pk,
    :optimized,
    :consumer,
    :pid,
    :oracle_pool,
    :caller_pid,
    rows: %{},
    must_refetch?: false,
    error: nil,
    timed_out?: false
  ]

  @doc """
  Creates a new checker for a shape, starting its StreamConsumer.

  The StreamConsumer sends messages to the calling process, which should be
  the process that will later call `await_up_to_date/2`.
  """
  def new(ctx, shape, oracle_pool, opts \\ []) do
    validate_identifier!(shape.table, "table")
    Enum.each(shape.columns, &validate_identifier!(&1, "column"))
    Enum.each(shape.pk, &validate_identifier!(&1, "pk column"))

    timeout_ms = opts[:timeout_ms] || 20_000

    shape_def = ShapeDefinition.new!(shape.table, where: shape.where)

    stream =
      Client.stream(ctx.client, shape_def,
        live: true,
        replica: :full,
        errors: :stream
      )

    {:ok, consumer} = StreamConsumer.start(stream, timeout: timeout_ms)

    %__MODULE__{
      name: shape.name,
      table: shape.table,
      where: shape.where,
      columns: shape.columns,
      pk: shape.pk,
      optimized: Map.get(shape, :optimized, false),
      consumer: consumer,
      pid: consumer.task_pid,
      oracle_pool: oracle_pool,
      caller_pid: self()
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
  Only receives messages from this checker's consumer (matched by pid).
  """
  def await_up_to_date(%__MODULE__{} = checker, timeout_ms) do
    checker = reset_events(checker)
    do_await(checker, timeout_ms, System.monotonic_time(:millisecond))
  end

  defp do_await(checker, timeout_ms, start_ms) do
    elapsed = System.monotonic_time(:millisecond) - start_ms
    remaining = max(0, timeout_ms - elapsed)

    receive do
      {:stream_message, pid, %ControlMessage{control: :up_to_date}} when pid == checker.pid ->
        checker

      {:stream_message, pid, %ChangeMessage{} = msg} when pid == checker.pid ->
        checker
        |> apply_change(msg)
        |> do_await(timeout_ms, start_ms)

      {:stream_message, pid, %ControlMessage{control: :must_refetch}} when pid == checker.pid ->
        %{checker | rows: %{}, must_refetch?: true}
        |> do_await(timeout_ms, start_ms)

      {:stream_message, pid, %Client.Error{} = error} when pid == checker.pid ->
        %{checker | error: error}

      {:stream_message, pid, _msg} when pid == checker.pid ->
        # Ignore other message types
        do_await(checker, timeout_ms, start_ms)
    after
      remaining ->
        %{checker | timed_out?: true}
    end
  end

  @doc """
  Apply a change message to update the checker's materialized rows.
  """
  def apply_message(checker, %ChangeMessage{} = msg) do
    apply_change(checker, msg)
  end

  defp reset_events(checker) do
    %{checker | must_refetch?: false, error: nil, timed_out?: false}
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
  Stop the checker's StreamConsumer.
  """
  def stop(%__MODULE__{consumer: consumer}) do
    StreamConsumer.stop(consumer)
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
