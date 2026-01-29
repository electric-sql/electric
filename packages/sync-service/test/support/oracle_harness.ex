defmodule Support.OracleHarness do
  @moduledoc """
  Generic harness for comparing Electric shape streams against Postgres query results.

  This module provides the framework for running parallel shape verification tests.
  It is schema-agnostic - use it with any schema by providing explicit shapes and mutations.

  For the standard 4-level hierarchy test schema, see `Support.OracleHarness.StandardSchema`.

  ## Usage

      shapes = [
        %{
          name: "my_shape",
          table: "my_table",
          where: "some_column = 'value'",
          columns: ["id", "some_column"],
          pk: ["id"],
          optimized: true
        }
      ]

      mutations = [
        %{name: "update_value", sql: "UPDATE my_table SET some_column = 'new' WHERE id = '1'"}
      ]

      test_against_oracle(ctx, shapes, mutations)
  """

  alias Support.OracleHarness.ShapeChecker

  @default_timeout_ms 20_000
  @default_oracle_pool_size 50

  # ----------------------------------------------------------------------------
  # Main Test Runner
  # ----------------------------------------------------------------------------

  def default_opts_from_env do
    %{
      oracle_pool_size: env_int("ORACLE_POOL_SIZE") || @default_oracle_pool_size
    }
  end

  @doc """
  Runs with explicit shapes and transactions, comparing Electric's output against Postgres.

  Transactions can be:
  - A list of transactions, where each transaction is a list of mutations (executed atomically)
  - A flat list of mutations (each mutation becomes its own transaction for backwards compatibility)

  ## Options

    - :oracle_pool_size - number of parallel oracle connections (default: 50, env: ORACLE_POOL_SIZE)
    - :timeout_ms - timeout for waiting on shapes (default: 20_000)
  """
  def test_against_oracle(ctx, shapes, transactions, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

    # Normalize transactions: wrap flat mutation lists into single-mutation transactions
    transactions = normalize_transactions(transactions)

    log_test_config(shapes, transactions)

    # Start oracle pool for parallel Postgres queries
    {:ok, oracle_pool} = start_oracle_pool(ctx, opts)

    # Start checker GenServers
    pids = start_checkers(ctx, shapes, oracle_pool, timeout_ms)

    # Check initial state (all in parallel)
    log("Checking initial snapshot for #{length(pids)} shapes")

    pids
    |> Task.async_stream(&ShapeChecker.check_initial_state/1, timeout: :infinity)
    |> Stream.run()

    # Run each transaction
    log("Running #{length(transactions)} transactions")

    transactions
    |> Enum.with_index(1)
    |> Enum.each(fn {mutations, txn_idx} ->
      run_transaction(ctx, pids, mutations, txn_idx)
    end)

    # Cleanup
    Enum.each(pids, &GenServer.stop/1)
    GenServer.stop(oracle_pool)
    :ok
  end

  # ----------------------------------------------------------------------------
  # Internal Implementation
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

  defp start_checkers(ctx, shapes, oracle_pool, timeout_ms) do
    Enum.map(shapes, fn shape ->
      {:ok, pid} = ShapeChecker.start_link(ctx, shape, oracle_pool, timeout_ms: timeout_ms)
      pid
    end)
  end

  defp run_transaction(ctx, pids, mutations, txn_idx) do
    txn_name = "txn_#{txn_idx}"
    cycle_start = System.monotonic_time(:millisecond)

    # Apply all mutations in a single transaction
    sql_statements = Enum.map(mutations, & &1.sql)
    apply_sql_transaction(ctx, sql_statements)

    apply_end = System.monotonic_time(:millisecond)

    # Check all shapes (polls until up_to_date, then verifies against oracle)
    pids
    |> Task.async_stream(&ShapeChecker.check_transaction(&1, txn_name), timeout: :infinity)
    |> Stream.run()

    check_end = System.monotonic_time(:millisecond)

    log(
      "#{txn_name} (#{length(mutations)} mutations): " <>
        "total=#{check_end - cycle_start}ms " <>
        "(apply=#{apply_end - cycle_start}ms, check=#{check_end - apply_end}ms)"
    )
  end

  defp log_test_config(shapes, transactions) do
    log("Starting #{length(shapes)} shapes")

    IO.puts("\n=== SHAPES ===")

    Enum.each(shapes, fn shape ->
      IO.puts("  #{shape.name}: #{shape.where}")
    end)

    total_mutations = transactions |> Enum.map(&length/1) |> Enum.sum()

    IO.puts("\n=== TRANSACTIONS (#{length(transactions)} txns, #{total_mutations} mutations) ===")

    transactions
    |> Enum.with_index(1)
    |> Enum.each(fn {mutations, txn_idx} ->
      IO.puts("  txn_#{txn_idx} (#{length(mutations)} mutations):")

      Enum.each(mutations, fn mutation ->
        IO.puts("    #{mutation.name}: #{mutation.sql}")
      end)
    end)

    IO.puts("")
  end

  # ----------------------------------------------------------------------------
  # Helpers
  # ----------------------------------------------------------------------------

  @doc false
  def apply_sql(_ctx, nil), do: :ok
  def apply_sql(ctx, sql) when is_list(sql), do: Enum.each(sql, &apply_sql(ctx, &1))

  def apply_sql(ctx, sql) when is_binary(sql) do
    Postgrex.query!(ctx.db_conn, sql, [])
  end

  @doc """
  Executes multiple SQL statements atomically within a single Postgres transaction.
  Uses Postgrex.transaction/3 which handles rollback on error automatically.
  """
  def apply_sql_transaction(_ctx, []), do: :ok

  def apply_sql_transaction(ctx, sql_statements) when is_list(sql_statements) do
    Postgrex.transaction(ctx.db_conn, fn conn ->
      Enum.each(sql_statements, fn sql ->
        Postgrex.query!(conn, sql, [])
      end)
    end)
  end

  @doc """
  Parses an environment variable as an integer.
  Returns nil if not set.
  """
  def env_int(name) do
    case System.get_env(name) do
      nil -> nil
      value -> String.to_integer(value)
    end
  end

  defp log(message) do
    IO.puts("[oracle] #{message}")
  end

  # Normalize transactions: if it's a flat list of mutations, wrap each in its own transaction
  defp normalize_transactions([]), do: []

  defp normalize_transactions([first | _] = transactions) when is_list(first) do
    # Already a list of transactions
    transactions
  end

  defp normalize_transactions([first | _] = mutations) when is_map(first) do
    # Flat list of mutations - wrap each in its own transaction
    Enum.map(mutations, &[&1])
  end
end
