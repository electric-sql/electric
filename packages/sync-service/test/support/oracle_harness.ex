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

  @default_timeout_ms 10_000
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
  Runs with explicit shapes and batches of transactions, comparing Electric's output against Postgres.

  Batches is a list of batches, where each batch is a list of transactions,
  and each transaction is a list of mutations. All transactions in a batch are
  applied sequentially (each in its own Postgres transaction), then all shape
  checkers verify once at the end of the batch.

  ## Options

    - :oracle_pool_size - number of parallel oracle connections (default: 50, env: ORACLE_POOL_SIZE)
    - :timeout_ms - timeout for waiting on shapes (default: 10_000)
  """
  def test_against_oracle(ctx, shapes, batches, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

    log_test_config(shapes, batches)

    # Start oracle pool for parallel Postgres queries
    {:ok, oracle_pool} = start_oracle_pool(ctx, opts)

    # Start checker GenServers
    pids = start_checkers(ctx, shapes, oracle_pool, timeout_ms)

    # Check initial state (all in parallel)
    log("Checking initial snapshot for #{length(pids)} shapes")

    pids
    |> Task.async_stream(&ShapeChecker.check_initial_state/1, timeout: :infinity)
    |> Stream.run()

    # Run each batch
    log("Running #{length(batches)} batches")

    batches
    |> Enum.with_index(1)
    |> Enum.each(fn {transactions, batch_idx} ->
      run_batch(ctx, pids, transactions, batch_idx)
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

  defp run_batch(ctx, pids, transactions, batch_idx) do
    batch_name = "batch_#{batch_idx}"
    total_mutations = transactions |> Enum.map(&length/1) |> Enum.sum()
    cycle_start = System.monotonic_time(:millisecond)

    # Apply all transactions in the batch sequentially
    Enum.each(transactions, fn mutations ->
      sql_statements = Enum.map(mutations, & &1.sql)
      apply_sql_transaction(ctx, sql_statements)
    end)

    apply_end = System.monotonic_time(:millisecond)

    # Check all shapes once for the entire batch
    pids
    |> Task.async_stream(&ShapeChecker.check_transaction(&1, batch_name), timeout: :infinity)
    |> Stream.run()

    check_end = System.monotonic_time(:millisecond)

    log(
      "#{batch_name} (#{length(transactions)} txns, #{total_mutations} mutations): " <>
        "total=#{check_end - cycle_start}ms " <>
        "(apply=#{apply_end - cycle_start}ms, check=#{check_end - apply_end}ms)"
    )
  end

  defp log_test_config(shapes, batches) do
    log("Starting #{length(shapes)} shapes")

    IO.puts("\n=== SHAPES ===")

    Enum.each(shapes, fn shape ->
      IO.puts("  #{shape.name}: #{shape.where}")
    end)

    total_txns = batches |> Enum.map(&length/1) |> Enum.sum()
    total_mutations = batches |> Enum.flat_map(& &1) |> Enum.map(&length/1) |> Enum.sum()

    IO.puts(
      "\n=== BATCHES (#{length(batches)} batches, #{total_txns} txns, #{total_mutations} mutations) ==="
    )

    batches
    |> Enum.with_index(1)
    |> Enum.each(fn {transactions, batch_idx} ->
      IO.puts("  batch_#{batch_idx} (#{length(transactions)} txns):")

      transactions
      |> Enum.with_index(1)
      |> Enum.each(fn {mutations, txn_idx} ->
        IO.puts("    txn_#{txn_idx} (#{length(mutations)} mutations):")

        Enum.each(mutations, fn mutation ->
          IO.puts("      #{mutation.name}: #{mutation.sql}")
        end)
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
      nil ->
        nil

      "" ->
        nil

      value ->
        case Integer.parse(value) do
          {int, ""} -> int
          _ -> raise "Invalid integer for #{name}=#{inspect(value)}"
        end
    end
  end

  defp log(message) do
    IO.puts("[oracle] #{message}")
  end
end
