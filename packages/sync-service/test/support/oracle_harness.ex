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
  # Max time to wait for changes after receiving up_to_date without changes (in ms)
  # This handles the case where LONG_POLL_TIMEOUT is short and Electric hasn't
  # processed changes yet. With 100ms timeout, this gives us 20 retries.
  @default_retry_window_ms 5_000

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

  Each transaction is a list of mutations that will be executed atomically within a
  single Postgres transaction (BEGIN/COMMIT).

  ## Options

    - :oracle_pool_size - number of parallel oracle connections (default: 50, env: ORACLE_POOL_SIZE)
    - :timeout_ms - timeout for waiting on shapes (default: 20_000)
  """
  def test_against_oracle(ctx, shapes, transactions, opts \\ %{}) do
    opts = Map.merge(default_opts_from_env(), opts)
    timeout_ms = opts[:timeout_ms] || @default_timeout_ms

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

    # Create all checkers (starts StreamConsumers)
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

  # Central message handling - messages are sent to the main process,
  # so we need a central receive loop (can't parallelize this part)
  #
  # The retry logic handles the case where LONG_POLL_TIMEOUT is short (e.g., 100ms)
  # and Electric hasn't processed changes yet. When up_to_date is received without
  # any changes, we retry for up to RETRY_WINDOW_MS before considering it truly done.
  # This is time-based so it works with any LONG_POLL_TIMEOUT setting.
  defp await_all_up_to_date(checkers, timeout_ms, step_name) do
    import ExUnit.Assertions

    retry_window_ms = env_int("RETRY_WINDOW_MS") || @default_retry_window_ms

    pid_to_checker = Map.new(checkers, &{&1.pid, &1})
    pending = MapSet.new(Enum.map(checkers, & &1.pid))
    # Track retry start time and whether changes were received
    # Format: %{pid => %{retry_start: nil | timestamp_ms, got_changes: false}}
    retry_state =
      Map.new(Enum.map(checkers, & &1.pid), fn pid ->
        {pid, %{retry_start: nil, got_changes: false}}
      end)

    start_ms = System.monotonic_time(:millisecond)

    updated_checkers =
      do_await_all(
        checkers,
        pid_to_checker,
        pending,
        retry_state,
        retry_window_ms,
        timeout_ms,
        start_ms
      )

    # Check for timeouts
    Enum.each(updated_checkers, fn checker ->
      if checker.timed_out? do
        flunk("Oracle timeout in step=#{step_name} shape=#{checker.name}")
      end
    end)

    updated_checkers
  end

  defp do_await_all(
         checkers,
         pid_to_checker,
         pending,
         retry_state,
         retry_window_ms,
         timeout_ms,
         start_ms
       ) do
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
              do_await_all(
                checkers,
                pid_to_checker,
                pending,
                retry_state,
                retry_window_ms,
                timeout_ms,
                start_ms
              )

            checker ->
              {updated_checker, updated_retry_state, done?} =
                handle_checker_message(checker, msg, retry_state, retry_window_ms)

              updated_checkers = update_checker_in_list(checkers, updated_checker)
              updated_pid_to_checker = Map.put(pid_to_checker, pid, updated_checker)
              pending = if done?, do: MapSet.delete(pending, pid), else: pending

              do_await_all(
                updated_checkers,
                updated_pid_to_checker,
                pending,
                updated_retry_state,
                retry_window_ms,
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

  defp handle_checker_message(
         checker,
         %Electric.Client.Message.ChangeMessage{} = msg,
         retry_state,
         _retry_window_ms
       ) do
    updated = ShapeChecker.apply_message(checker, msg)
    # Got a change, mark that we received changes and reset retry timer
    updated_retry_state =
      Map.put(retry_state, checker.pid, %{retry_start: nil, got_changes: true})

    {updated, updated_retry_state, false}
  end

  defp handle_checker_message(
         checker,
         %Electric.Client.Message.ControlMessage{
           control: :up_to_date
         },
         retry_state,
         retry_window_ms
       ) do
    state = Map.get(retry_state, checker.pid, %{retry_start: nil, got_changes: false})
    now = System.monotonic_time(:millisecond)

    cond do
      # If we got changes since we started waiting, we're done
      state.got_changes ->
        {checker, retry_state, true}

      # No changes received - check if oracle matches materialized state
      # If they match, we're done (no changes expected). If they differ, retry.
      true ->
        oracle_rows = ShapeChecker.query_oracle(checker)
        materialized = ShapeChecker.materialized_rows(checker)

        if materialized == oracle_rows do
          # Oracle matches - no changes expected or Electric already processed them
          {checker, retry_state, true}
        else
          # Oracle differs - Electric hasn't processed changes yet
          # Start or continue retry window
          retry_start = state.retry_start || now

          if now - retry_start >= retry_window_ms do
            # Exceeded retry window - give up (will fail in verify step)
            {checker, retry_state, true}
          else
            updated_retry_state =
              Map.put(retry_state, checker.pid, %{retry_start: retry_start, got_changes: false})

            {checker, updated_retry_state, false}
          end
        end
    end
  end

  defp handle_checker_message(
         checker,
         %Electric.Client.Message.ControlMessage{
           control: :must_refetch
         },
         retry_state,
         _retry_window_ms
       ) do
    updated = %{checker | rows: %{}, must_refetch?: true}
    # Reset retry state after must_refetch
    updated_retry_state =
      Map.put(retry_state, checker.pid, %{retry_start: nil, got_changes: false})

    {updated, updated_retry_state, false}
  end

  defp handle_checker_message(
         checker,
         %Electric.Client.Error{} = error,
         retry_state,
         _retry_window_ms
       ) do
    updated = %{checker | error: error}
    {updated, retry_state, true}
  end

  defp handle_checker_message(checker, _msg, retry_state, _retry_window_ms) do
    {checker, retry_state, false}
  end

  defp update_checker_in_list(checkers, updated_checker) do
    Enum.map(checkers, fn checker ->
      if checker.pid == updated_checker.pid, do: updated_checker, else: checker
    end)
  end

  # Flush stale messages from the mailbox that accumulated while not listening.
  # This is important because StreamConsumers continue polling during verify phase,
  # which can queue thousands of up_to_date messages. Processing these before the
  # actual change messages arrive causes the retry window to expire.
  defp flush_stale_messages(checkers, pid_to_checker) do
    do_flush_stale_messages(checkers, pid_to_checker, 0)
  end

  defp do_flush_stale_messages(checkers, pid_to_checker, count) do
    receive do
      {:stream_message, pid, msg} ->
        case Map.get(pid_to_checker, pid) do
          nil ->
            # Unknown pid, ignore
            do_flush_stale_messages(checkers, pid_to_checker, count + 1)

          checker ->
            # Apply ChangeMessages to keep checker state current
            # Discard ControlMessages (stale up_to_date)
            updated_checker =
              case msg do
                %Electric.Client.Message.ChangeMessage{} ->
                  ShapeChecker.apply_message(checker, msg)

                _ ->
                  checker
              end

            updated_checkers = update_checker_in_list(checkers, updated_checker)
            updated_pid_to_checker = Map.put(pid_to_checker, pid, updated_checker)
            do_flush_stale_messages(updated_checkers, updated_pid_to_checker, count + 1)
        end
    after
      0 ->
        # No more messages in mailbox
        {checkers, count}
    end
  end

  defp run_transaction_cycle(ctx, checkers, mutations, txn_idx, timeout_ms, oracle_before) do
    txn_name = "txn_#{txn_idx} (#{length(mutations)} mutations)"
    cycle_start = System.monotonic_time(:millisecond)

    # Phase 0: Flush stale messages that accumulated while not listening
    # This prevents old up_to_date messages from triggering oracle checks
    # while the actual change messages are still queued
    pid_to_checker = Map.new(checkers, &{&1.pid, &1})
    {checkers, flushed_count} = flush_stale_messages(checkers, pid_to_checker)

    flush_end = System.monotonic_time(:millisecond)

    # Phase 1: Apply all mutations in a single transaction
    sql_statements = Enum.map(mutations, & &1.sql)
    apply_sql_transaction(ctx, sql_statements)

    apply_end = System.monotonic_time(:millisecond)

    # Phase 2: Wait for all clients to be up_to_date (central receive loop)
    checkers = await_all_up_to_date(checkers, timeout_ms, txn_name)

    await_end = System.monotonic_time(:millisecond)

    # Phase 3: Query oracle_after and verify in parallel
    # Returns {checkers, oracle_after} so oracle_after can be reused as next oracle_before
    result = verify_all_parallel(checkers, txn_name, oracle_before)

    verify_end = System.monotonic_time(:millisecond)

    log(
      "#{txn_name} timing: total=#{verify_end - cycle_start}ms " <>
        "(flush=#{flush_end - cycle_start}ms/#{flushed_count}msgs, " <>
        "apply=#{apply_end - flush_end}ms, " <>
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
end
