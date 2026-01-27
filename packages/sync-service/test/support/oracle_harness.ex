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

    # Start oracle pool for parallel Postgres queries
    {:ok, oracle_pool} = start_oracle_pool(ctx, opts)

    # Create all checkers
    checkers = start_checkers(ctx, shapes, oracle_pool, opts)

    log("Waiting for initial snapshot")
    checkers = await_all_up_to_date(checkers, timeout_ms, "initial snapshot")

    log("Running #{length(transactions)} transactions (#{total_mutations} mutations)")

    # Get initial oracle state to pass to first transaction
    initial_oracle = query_all_oracles_parallel(checkers)

    # Pass oracle_after from each transaction as oracle_before for the next one
    # This cuts oracle queries in half since oracle_before is typically the same as previous oracle_after
    {checkers, _final_oracle} =
      transactions
      |> Enum.with_index(1)
      |> Enum.reduce({checkers, initial_oracle}, fn {mutations, txn_idx}, {checkers, prev_oracle} ->
        run_transaction_cycle(ctx, checkers, mutations, txn_idx, timeout_ms, prev_oracle)
      end)

    stop_checkers(checkers)
    GenServer.stop(oracle_pool)
    :ok
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

  # Poll all checkers in parallel using Task.async_stream
  defp await_all_up_to_date(checkers, timeout_ms, step_name) do
    import ExUnit.Assertions

    updated_checkers =
      checkers
      |> Task.async_stream(
        fn checker -> ShapeChecker.await_up_to_date(checker, timeout_ms) end,
        max_concurrency: length(checkers),
        timeout: timeout_ms + 5_000,
        on_timeout: :kill_task
      )
      |> Enum.map(fn
        {:ok, checker} ->
          checker

        {:exit, :timeout} ->
          flunk("Task timeout in step=#{step_name}")

        {:exit, reason} ->
          flunk("Checker failed in step=#{step_name}: #{inspect(reason)}")
      end)

    # Check for individual checker timeouts
    Enum.each(updated_checkers, fn checker ->
      if checker.timed_out? do
        flunk("Oracle timeout in step=#{step_name} shape=#{checker.name}")
      end
    end)

    updated_checkers
  end

  defp run_transaction_cycle(ctx, checkers, mutations, txn_idx, timeout_ms, oracle_before) do
    txn_name = "txn_#{txn_idx} (#{length(mutations)} mutations)"
    cycle_start = System.monotonic_time(:millisecond)

    # Phase 1: Apply all mutations in a single transaction
    sql_statements = Enum.map(mutations, & &1.sql)
    apply_sql_transaction(ctx, sql_statements)

    apply_end = System.monotonic_time(:millisecond)

    # Phase 2: Wait for all clients to be up_to_date (parallel polling)
    checkers = await_all_up_to_date(checkers, timeout_ms, txn_name)

    await_end = System.monotonic_time(:millisecond)

    # Phase 3: Query oracle_after and verify in parallel
    # Returns {checkers, oracle_after} so oracle_after can be reused as next oracle_before
    result = verify_all_parallel(checkers, txn_name, oracle_before)

    verify_end = System.monotonic_time(:millisecond)

    log(
      "#{txn_name} timing: total=#{verify_end - cycle_start}ms " <>
        "(apply=#{apply_end - cycle_start}ms, " <>
        "await=#{await_end - apply_end}ms, " <>
        "verify=#{verify_end - await_end}ms)"
    )

    result
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

  defp verify_all_parallel(checkers, step_name, oracle_before) do
    results =
      checkers
      |> Task.async_stream(
        fn checker ->
          oracle_after = ShapeChecker.query_oracle(checker)

          ShapeChecker.assert_consistent!(
            checker,
            step_name,
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
          flunk("Oracle query timeout in step=#{step_name}")

        {:exit, reason} ->
          import ExUnit.Assertions
          flunk("Checker failed in step=#{step_name}: #{inspect(reason)}")
      end)

    checkers = Enum.map(results, fn {checker, _oracle} -> checker end)
    oracle_after = Map.new(results, fn {checker, oracle} -> {checker.name, oracle} end)
    {checkers, oracle_after}
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
