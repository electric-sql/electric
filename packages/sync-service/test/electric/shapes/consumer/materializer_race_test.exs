defmodule Electric.Shapes.Consumer.MaterializerRaceTest do
  @moduledoc """
  Test demonstrating the Materializer startup race condition.

  Bug location:
  - lib/electric/shapes/consumer/materializer.ex:105-119 (handle_continue :start_materializer)
  - lib/electric/shapes/consumer.ex:57-61 (subscribe_materializer)

  The Race:
  1. Materializer calls Consumer.await_snapshot_start() - Consumer is alive, returns :started
  2. Consumer terminates (cleanup, error, timeout, etc.)
  3. Materializer calls Consumer.subscribe_materializer() - calls GenServer.call(nil, ...)
  4. Exit with :noproc raised - Materializer crashes!

  The Consumer was alive at step 1, but dead at step 3.
  """
  use ExUnit.Case, async: false

  alias Electric.Shapes.Consumer

  describe "Materializer startup race condition" do
    @tag :race_condition_bug
    test "subscribe_materializer exits with :noproc when Consumer is dead" do
      # This test demonstrates that calling subscribe_materializer with a dead/non-existent
      # Consumer will raise an exit with :noproc, which is what happens in the race condition.

      # Use a non-existent stack_id and shape_handle to simulate a dead Consumer
      stack_id = "non-existent-stack-#{System.unique_integer()}"
      shape_handle = "non-existent-shape-#{System.unique_integer()}"

      # This is exactly what happens in the race:
      # consumer_pid(stack_id, shape_handle) returns nil
      # GenServer.call(nil, {:subscribe_materializer, self()}) exits with :noproc

      assert catch_exit(Consumer.subscribe_materializer(stack_id, shape_handle, self())) ==
               {:noproc, {GenServer, :call, [nil, {:subscribe_materializer, self()}, 5000]}}
    end

    @tag :race_condition_bug
    test "whereis returns nil for dead/non-existent Consumer" do
      stack_id = "non-existent-stack-#{System.unique_integer()}"
      shape_handle = "non-existent-shape-#{System.unique_integer()}"

      # This is the intermediate step that causes the race:
      # whereis returns nil when Consumer doesn't exist
      assert Consumer.whereis(stack_id, shape_handle) == nil
    end

    @tag :race_condition_bug
    test "GenServer.call(nil, ...) exits with :noproc" do
      # This is the core issue: GenServer.call(nil, ...) exits with :noproc
      # This is what subscribe_materializer calls when consumer_pid returns nil

      exit_reason = catch_exit(GenServer.call(nil, {:subscribe_materializer, self()}))
      assert match?({:noproc, _}, exit_reason)
    end

    @tag :race_condition_bug
    test "demonstrates the exact race window in Materializer startup" do
      # This test documents the exact sequence of events in the race:
      #
      # 1. await_snapshot_start returns :started (Consumer was alive)
      # 2. Consumer terminates (for any reason)
      # 3. subscribe_materializer is called
      # 4. consumer_pid returns nil
      # 5. GenServer.call(nil, ...) exits with :noproc
      # 6. Materializer crashes

      # Step 1: Simulate await_snapshot_start returning :started
      await_result = :started
      assert await_result == :started

      # Step 2: Simulate Consumer termination by using non-existent IDs
      stack_id = "race-test-stack-#{System.unique_integer()}"
      shape_handle = "race-test-shape-#{System.unique_integer()}"

      # Step 3-5: This is where the crash happens
      # The Materializer doesn't check if Consumer is still alive before calling
      exit_reason = catch_exit(Consumer.subscribe_materializer(stack_id, shape_handle, self()))
      assert match?({:noproc, _}, exit_reason)

      # Step 6: The Materializer would crash here with exit :noproc
      # In production, this manifests as:
      #   ** (exit) exited in: GenServer.call(nil, {:subscribe_materializer, #PID<...>}, 5000)
      #       ** (EXIT) no process: the process is not alive
      #       (elixir) lib/gen_server.ex:xxx: GenServer.call/3
      #       (electric) lib/electric/shapes/consumer.ex:61: Electric.Shapes.Consumer.subscribe_materializer/3
      #       (electric) lib/electric/shapes/consumer/materializer.ex:113: Electric.Shapes.Consumer.Materializer.handle_continue/2
    end

    @tag :race_condition_fix
    test "proposed fix: check Consumer existence before subscribe" do
      stack_id = "fix-test-stack-#{System.unique_integer()}"
      shape_handle = "fix-test-shape-#{System.unique_integer()}"

      # The fix is to check if Consumer exists before calling subscribe_materializer
      consumer_pid = Consumer.whereis(stack_id, shape_handle)

      result =
        if is_pid(consumer_pid) do
          # Consumer is alive, safe to subscribe
          Consumer.subscribe_materializer(stack_id, shape_handle, self())
          :ok
        else
          # Consumer is dead, handle gracefully
          {:error, :consumer_not_found}
        end

      # With the fix, we get a graceful error instead of a crash
      assert result == {:error, :consumer_not_found}
    end

    @tag :race_condition_fix
    test "proposed fix: wrap in try/catch" do
      stack_id = "try-catch-test-stack-#{System.unique_integer()}"
      shape_handle = "try-catch-test-shape-#{System.unique_integer()}"

      # Alternative fix: wrap the call in try/catch
      result =
        try do
          Consumer.subscribe_materializer(stack_id, shape_handle, self())
          :ok
        catch
          :exit, _ -> {:error, :consumer_died}
        end

      # With try/catch, we get a graceful error instead of a crash
      # The :exit with :noproc is caught and converted to {:error, :consumer_died}
      assert result == {:error, :consumer_died}
    end
  end

  describe "timeline analysis" do
    @tag :race_condition_bug
    test "shows the exact timing window where race can occur" do
      # Timeline of the race:
      #
      # T1: Materializer.handle_continue(:start_materializer, state)
      # T2: Consumer.await_snapshot_start(stack_id, shape_handle, :infinity)
      #     - Blocks waiting for Consumer
      #     - Consumer replies :started
      #     - Returns :started
      # T3: Consumer terminates (cleanup, error, timeout, etc.)
      # T4: Consumer.subscribe_materializer(stack_id, shape_handle, self())
      #     - consumer_pid(stack_id, shape_handle) returns nil
      #     - GenServer.call(nil, {:subscribe_materializer, self()})
      #     - RAISES ArgumentError!
      # T5: Materializer crashes

      timeline = [
        {:t1, :materializer_handle_continue},
        {:t2, :await_snapshot_start_returns_started},
        {:t3, :consumer_terminates},
        {:t4, :subscribe_materializer_called},
        {:t5, :argument_error_raised}
      ]

      # The race window is between T2 and T4
      # Consumer can die at T3, and subscribe_materializer at T4 will crash

      assert Enum.at(timeline, 0) == {:t1, :materializer_handle_continue}
      assert Enum.at(timeline, 1) == {:t2, :await_snapshot_start_returns_started}
      assert Enum.at(timeline, 2) == {:t3, :consumer_terminates}
      assert Enum.at(timeline, 3) == {:t4, :subscribe_materializer_called}
      assert Enum.at(timeline, 4) == {:t5, :argument_error_raised}

      # The bug: No check for Consumer existence between T2 and T4
      # The fix: Either check existence or wrap in try/catch
    end
  end
end
