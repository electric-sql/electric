defmodule Electric.Shapes.ConsumerRegistryRaceTest do
  @moduledoc """
  Test demonstrating the race condition in ConsumerRegistry.publish/2 where
  a shape can be removed from ShapeStatus before it's removed from EventRouter,
  causing Process.monitor(nil) to crash.

  Bug location:
  - lib/electric/shape_cache/shape_cleaner.ex:156-177 (incorrect ordering)
  - lib/electric/shapes/consumer_registry.ex:86,127 (missing nil check)

  The race window occurs when:
  1. ShapeStatus.remove_shape executes (immediate)
  2. Consumer.stop executes (immediate)
  3. ShapeLogCollector.remove_shape is batched (async via RequestBatcher)
  4. A transaction arrives BEFORE the EventRouter removal is processed
  5. EventRouter routes to the shape (still in filter)
  6. ConsumerRegistry.publish tries to start consumer
  7. start_consumer! returns nil (ShapeStatus says shape doesn't exist)
  8. Process.monitor(nil) crashes with ArgumentError
  """
  use ExUnit.Case, async: true

  alias Electric.Shapes.ConsumerRegistry

  import Support.ComponentSetup

  setup :with_stack_id_from_test

  setup(ctx) do
    %{stack_id: stack_id} = ctx

    {:ok, registry_state} = ConsumerRegistry.new(stack_id)

    [registry_state: registry_state]
  end

  describe "race condition: shape removed from ShapeStatus but still in EventRouter" do
    @tag :race_condition_bug
    test "crashes with ArgumentError when start_consumer_for_handle returns {:error, :no_shape}", ctx do
      %{stack_id: stack_id, registry_state: registry_state} = ctx

      # Simulate the race condition:
      # - Shape is still in EventRouter (events are routed to it)
      # - Shape is NOT in ShapeStatus (removed during cleanup)
      # - Consumer is NOT running (stopped during cleanup)
      #
      # When publish is called:
      # 1. consumer_pid returns nil (no consumer in registry)
      # 2. start_consumer! calls ShapeCache.start_consumer_for_handle
      # 3. ShapeCache queries ShapeStatus -> shape not found
      # 4. Returns {:error, :no_shape}
      # 5. start_consumer! returns nil
      # 6. broadcast receives nil pid
      # 7. Process.monitor(nil) crashes!

      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        fn _handle, ^stack_id ->
          # Simulate the race: ShapeStatus says shape doesn't exist
          {:error, :no_shape}
        end
      )

      # This should crash with ArgumentError from Process.monitor(nil)
      # because ConsumerRegistry.publish doesn't filter out nil pids
      assert_raise ArgumentError, fn ->
        ConsumerRegistry.publish(
          %{"race-condition-shape" => {:handle_event, %{test: true}, nil}},
          registry_state
        )
      end
    end

    @tag :race_condition_bug
    test "demonstrates the exact crash: send(nil, msg) raises ArgumentError", _ctx do
      # In older Erlang/OTP versions, Process.monitor(nil) raised ArgumentError
      # In newer versions (OTP 24+), it returns a reference but send(nil, msg) raises
      # The crash in ConsumerRegistry.broadcast happens at the send() call:
      #   send(pid, {:"$gen_call", {self(), ref}, event})
      assert_raise ArgumentError, ~r/invalid destination/, fn ->
        send(nil, :test_message)
      end
    end

    @tag :race_condition_bug
    test "broadcast crashes when given nil pid in tuple list" do
      # Direct proof that ConsumerRegistry.broadcast crashes with nil pid
      # The crash occurs at send(pid, ...) inside broadcast/1
      assert_raise ArgumentError, ~r/invalid destination/, fn ->
        ConsumerRegistry.broadcast([
          {"shape-handle", {:some_event, %{}}, nil}
        ])
      end
    end
  end

  describe "proposed fix verification" do
    @tag :race_condition_fix
    test "filtering nil pids before broadcast prevents crash", ctx do
      %{stack_id: stack_id, registry_state: registry_state} = ctx

      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        fn _handle, ^stack_id ->
          {:error, :no_shape}
        end
      )

      # This is what the FIXED code should do:
      # Filter out nil pids before calling broadcast
      events_by_handle = %{"race-condition-shape" => {:handle_event, %{test: true}, nil}}

      %{table: _table} = registry_state

      result =
        events_by_handle
        |> Enum.map(fn {handle, event} ->
          pid = ConsumerRegistry.whereis(ctx.stack_id, handle)

          pid =
            if is_nil(pid) do
              case Electric.ShapeCache.start_consumer_for_handle(handle, stack_id) do
                {:ok, p} -> p
                {:error, :no_shape} -> nil
              end
            else
              pid
            end

          {handle, event, pid}
        end)
        # THE FIX: Filter out nil pids
        |> Enum.reject(fn {_handle, _event, pid} -> is_nil(pid) end)

      # With filtering, the list is empty, so broadcast receives no items
      assert result == []

      # And broadcast with empty list doesn't crash
      assert ConsumerRegistry.broadcast([]) == %{}
    end
  end

  describe "race condition timing demonstration" do
    @tag :race_condition_bug
    test "simulates the exact timing of the race", ctx do
      %{stack_id: stack_id, registry_state: registry_state} = ctx
      parent = self()

      # Track the sequence of operations
      operations = :ets.new(:operations, [:ordered_set, :public])
      counter = :counters.new(1, [:atomics])

      log_op = fn name ->
        :counters.add(counter, 1, 1)
        seq = :counters.get(counter, 1)
        :ets.insert(operations, {seq, name})
      end

      # Patch ShapeStatus.remove_shape to log when it's called
      Repatch.patch(
        Electric.ShapeCache.ShapeStatus,
        :remove_shape,
        fn ^stack_id, _handle ->
          log_op.(:shape_status_remove)
          send(parent, :shape_status_removed)
          :ok
        end
      )

      # Patch start_consumer_for_handle to simulate the race
      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        fn _handle, ^stack_id ->
          log_op.(:start_consumer_called)
          # At this point, ShapeStatus was already updated
          # This is the race condition - shape no longer exists in status
          {:error, :no_shape}
        end
      )

      # Simulate the cleanup sequence (as in ShapeCleaner.remove_shape_immediate)
      # Step 1: Remove from ShapeStatus (happens FIRST in current code)
      Electric.ShapeCache.ShapeStatus.remove_shape(stack_id, "test-shape")
      assert_receive :shape_status_removed

      # Step 2: Consumer would be stopped here (simulated - no actual consumer)

      # Step 3: Storage cleanup would happen here (simulated)

      # RACE WINDOW: Between step 1-3 and step 4 (EventRouter removal)
      # A transaction arrives and tries to publish to the shape

      # This crashes because:
      # - EventRouter still has the shape (removal is async/batched)
      # - But ShapeStatus says it doesn't exist
      # - So start_consumer_for_handle returns {:error, :no_shape}
      # - Which becomes nil
      # - And Process.monitor(nil) crashes
      assert_raise ArgumentError, fn ->
        ConsumerRegistry.publish(
          %{"test-shape" => {:handle_event, %{test: true}, nil}},
          registry_state
        )
      end

      # Verify the operation sequence
      ops = :ets.tab2list(operations) |> Enum.map(&elem(&1, 1))
      assert :shape_status_remove in ops
      assert :start_consumer_called in ops

      # The race: start_consumer was called AFTER shape_status was removed
      shape_status_idx = Enum.find_index(ops, &(&1 == :shape_status_remove))
      start_consumer_idx = Enum.find_index(ops, &(&1 == :start_consumer_called))
      assert start_consumer_idx > shape_status_idx
    end
  end
end
