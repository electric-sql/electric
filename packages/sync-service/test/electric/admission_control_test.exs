defmodule Electric.AdmissionControlTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup

  alias Electric.AdmissionControl

  describe "admission control with custom table" do
    setup [:with_stack_id_from_test]

    setup %{stack_id: stack_id} do
      # Create a unique table name for each test
      table_name = :"test_admission_#{stack_id}"
      {:ok, pid} = start_supervised({AdmissionControl, table_name: table_name, name: nil})
      %{table_name: table_name, pid: pid}
    end

    test "allows acquiring permits up to the limit", %{table_name: table_name, stack_id: stack_id} do
      # Should be able to acquire 3 permits
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 3,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 3,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 3,
                 table_name: table_name
               )

      # Fourth should fail
      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 3,
                 table_name: table_name
               )
    end

    test "allows releasing permits", %{table_name: table_name, stack_id: stack_id} do
      # Acquire up to limit
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Release one
      assert :ok = AdmissionControl.release(stack_id, :initial, table_name: table_name)

      # Should be able to acquire again
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )
    end

    test "tracks initial and existing separately", %{table_name: table_name, stack_id: stack_id} do
      # Acquire 2 initial permits
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Should still be able to acquire existing permits
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :existing,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :existing,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Both should be at limit now
      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id, :existing,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Verify counts
      assert %{initial: 2, existing: 2} =
               AdmissionControl.get_current(stack_id, table_name: table_name)
    end

    test "get_current returns correct counts", %{table_name: table_name, stack_id: stack_id} do
      # Initially should be zero
      assert %{initial: 0, existing: 0} =
               AdmissionControl.get_current(stack_id, table_name: table_name)

      # Acquire some permits
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 10,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 10,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :existing,
                 max_concurrent: 10,
                 table_name: table_name
               )

      # Should show correct counts
      assert %{initial: 2, existing: 1} =
               AdmissionControl.get_current(stack_id, table_name: table_name)

      # Release some
      assert :ok = AdmissionControl.release(stack_id, :initial, table_name: table_name)

      # Should update
      assert %{initial: 1, existing: 1} =
               AdmissionControl.get_current(stack_id, table_name: table_name)
    end

    test "handles multiple stacks independently", %{table_name: table_name, stack_id: stack_id} do
      # Use the generated stack_id as base, and create two variations
      stack_id_1 = "#{stack_id}-a"
      stack_id_2 = "#{stack_id}-b"

      # Acquire permits for both stacks
      assert :ok =
               AdmissionControl.try_acquire(stack_id_1, :initial,
                 max_concurrent: 1,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id_2, :initial,
                 max_concurrent: 1,
                 table_name: table_name
               )

      # Both should be at limit
      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id_1, :initial,
                 max_concurrent: 1,
                 table_name: table_name
               )

      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id_2, :initial,
                 max_concurrent: 1,
                 table_name: table_name
               )

      # Counts should be separate
      assert %{initial: 1, existing: 0} =
               AdmissionControl.get_current(stack_id_1, table_name: table_name)

      assert %{initial: 1, existing: 0} =
               AdmissionControl.get_current(stack_id_2, table_name: table_name)
    end

    test "doesn't go below zero when releasing", %{table_name: table_name, stack_id: stack_id} do
      # Release without acquiring should not crash
      assert :ok = AdmissionControl.release(stack_id, :initial, table_name: table_name)
      assert :ok = AdmissionControl.release(stack_id, :initial, table_name: table_name)

      # Counter should stay at 0
      assert %{initial: 0, existing: 0} =
               AdmissionControl.get_current(stack_id, table_name: table_name)
    end

    test "emits telemetry events on acquire", %{table_name: table_name, stack_id: stack_id} do
      # Attach telemetry handler
      test_pid = self()
      ref = make_ref()
      handler_id = "test-acquire-#{inspect(ref)}"

      :telemetry.attach(
        handler_id,
        [:electric, :admission_control, :acquire],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:telemetry_acquire, event, measurements, metadata})
        end,
        nil
      )

      # Acquire a permit
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 10,
                 table_name: table_name
               )

      # Should receive telemetry event (match on stack_id to filter out concurrent tests)
      assert_receive {:telemetry_acquire, [:electric, :admission_control, :acquire], measurements,
                      %{stack_id: ^stack_id} = metadata}

      assert measurements.count == 1
      assert measurements.current == 1
      assert measurements.limit == 10
      assert metadata.kind == :initial

      :telemetry.detach(handler_id)
    end

    test "emits telemetry events on reject", %{table_name: table_name, stack_id: stack_id} do
      # Attach telemetry handler
      test_pid = self()
      ref = make_ref()
      handler_id = "test-reject-#{inspect(ref)}"

      :telemetry.attach(
        handler_id,
        [:electric, :admission_control, :reject],
        fn event, measurements, metadata, _config ->
          send(test_pid, {:telemetry_reject, event, measurements, metadata})
        end,
        nil
      )

      # Fill up permits
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Try to acquire one more (should be rejected)
      assert {:error, :overloaded} =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 2,
                 table_name: table_name
               )

      # Should receive telemetry event (match on stack_id to filter out concurrent tests)
      assert_receive {:telemetry_reject, [:electric, :admission_control, :reject], measurements,
                      %{stack_id: ^stack_id} = metadata}

      assert measurements.count == 1
      assert measurements.limit == 2
      assert metadata.kind == :initial
      assert metadata.reason == :overloaded
      assert metadata.current == 3

      :telemetry.detach(handler_id)
    end

    test "concurrent access is thread-safe", %{table_name: table_name, stack_id: stack_id} do
      max_concurrent = 10

      # Spawn 20 tasks trying to acquire permits
      tasks =
        for _ <- 1..20 do
          Task.async(fn ->
            AdmissionControl.try_acquire(stack_id, :initial,
              max_concurrent: max_concurrent,
              table_name: table_name
            )
          end)
        end

      results = Enum.map(tasks, &Task.await/1)

      # Should have exactly max_concurrent successful acquisitions
      successful = Enum.count(results, &(&1 == :ok))
      failed = Enum.count(results, &(&1 == {:error, :overloaded}))

      assert successful == max_concurrent
      assert failed == 10

      # Verify final count
      assert %{initial: ^max_concurrent, existing: 0} =
               AdmissionControl.get_current(stack_id, table_name: table_name)
    end

    test "release decrements the correct kind", %{table_name: table_name, stack_id: stack_id} do
      # Acquire both kinds
      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 10,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :initial,
                 max_concurrent: 10,
                 table_name: table_name
               )

      assert :ok =
               AdmissionControl.try_acquire(stack_id, :existing,
                 max_concurrent: 10,
                 table_name: table_name
               )

      assert %{initial: 2, existing: 1} =
               AdmissionControl.get_current(stack_id, table_name: table_name)

      # Release initial
      assert :ok = AdmissionControl.release(stack_id, :initial, table_name: table_name)

      assert %{initial: 1, existing: 1} =
               AdmissionControl.get_current(stack_id, table_name: table_name)

      # Release existing
      assert :ok = AdmissionControl.release(stack_id, :existing, table_name: table_name)

      assert %{initial: 1, existing: 0} =
               AdmissionControl.get_current(stack_id, table_name: table_name)
    end
  end

  describe "try_swap/4" do
    setup do
      table_name = :"swap_counter_#{System.unique_integer([:positive])}"
      {:ok, _} = start_supervised({AdmissionControl, table_name: table_name, name: nil})
      %{table_name: table_name}
    end

    test "moves the in-flight count from :initial to :existing", %{table_name: t} do
      :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 10)
      assert %{initial: 1, existing: 0} = AdmissionControl.get_current("s", table_name: t)

      assert :ok =
               AdmissionControl.try_swap("s", :initial, :existing,
                 table_name: t,
                 max_concurrent: 10
               )

      assert %{initial: 0, existing: 1} = AdmissionControl.get_current("s", table_name: t)
    end

    test "returns {:error, :overloaded} when the destination bucket is full",
         %{table_name: t} do
      # Saturate :existing.
      for _ <- 1..3 do
        :ok = AdmissionControl.try_acquire("s", :existing, table_name: t, max_concurrent: 3)
      end

      :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 10)

      assert {:error, :overloaded} =
               AdmissionControl.try_swap("s", :initial, :existing,
                 table_name: t,
                 max_concurrent: 3
               )

      # On failure, source must be unchanged.
      assert %{initial: 1, existing: 3} = AdmissionControl.get_current("s", table_name: t)
    end

    test "is atomic under concurrent swap attempts at the cap", %{table_name: t} do
      # Acquire 10 :initial permits, cap :existing at 5, run 10 concurrent swaps,
      # exactly 5 should succeed.
      for _ <- 1..10 do
        :ok = AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 100)
      end

      tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            AdmissionControl.try_swap("s", :initial, :existing,
              table_name: t,
              max_concurrent: 5
            )
          end)
        end

      results = Task.await_many(tasks)
      assert Enum.count(results, &(&1 == :ok)) == 5
      assert Enum.count(results, &(&1 == {:error, :overloaded})) == 5
      assert %{initial: 5, existing: 5} = AdmissionControl.get_current("s", table_name: t)
    end

    test "concurrent rejected swaps preserve the destination counter", %{table_name: t} do
      # Pre-saturate :existing at cap=5 via direct acquires.
      for _ <- 1..5 do
        :ok =
          AdmissionControl.try_acquire("s", :existing, table_name: t, max_concurrent: 5)
      end

      # Pre-acquire 10 :initial permits so we have real permits to swap from.
      for _ <- 1..10 do
        :ok =
          AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 100)
      end

      assert %{initial: 10, existing: 5} = AdmissionControl.get_current("s", table_name: t)

      # All swaps target a saturated :existing — all must reject.
      tasks =
        for _ <- 1..10 do
          Task.async(fn ->
            AdmissionControl.try_swap("s", :initial, :existing,
              table_name: t,
              max_concurrent: 5
            )
          end)
        end

      results = Task.await_many(tasks)

      assert Enum.all?(results, &(&1 == {:error, :overloaded}))

      # Both buckets are exactly back to their starting values.
      assert %{initial: 10, existing: 5} = AdmissionControl.get_current("s", table_name: t)
    end

    test "from_kind cap is preserved against concurrent try_acquire during swap", %{table_name: t} do
      # Saturate :initial at cap=2.
      :ok =
        AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 2)

      :ok =
        AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 2)

      # Saturate :existing at cap=2 so every swap rejects (which is the
      # scenario where the from_kind transient under-count would otherwise
      # bite on rollback).
      :ok =
        AdmissionControl.try_acquire("s", :existing, table_name: t, max_concurrent: 2)

      :ok =
        AdmissionControl.try_acquire("s", :existing, table_name: t, max_concurrent: 2)

      # Race many try_swap calls (all will reject) against many
      # try_acquire(:initial) calls (all should reject — :initial is at cap).
      swap_tasks =
        for _ <- 1..50 do
          Task.async(fn ->
            AdmissionControl.try_swap("s", :initial, :existing,
              table_name: t,
              max_concurrent: 2
            )
          end)
        end

      acquire_tasks =
        for _ <- 1..50 do
          Task.async(fn ->
            AdmissionControl.try_acquire("s", :initial, table_name: t, max_concurrent: 2)
          end)
        end

      swap_results = Task.await_many(swap_tasks)
      acquire_results = Task.await_many(acquire_tasks)

      # Every swap rejects (:existing is at cap).
      assert Enum.all?(swap_results, &(&1 == {:error, :overloaded}))

      # Every acquire rejects (:initial was at cap and try_swap never
      # creates a transient under-count for from_kind).
      assert Enum.all?(acquire_results, &(&1 == {:error, :overloaded}))

      # Both buckets stayed at exactly their caps.
      assert %{initial: 2, existing: 2} = AdmissionControl.get_current("s", table_name: t)
    end
  end

  describe "default table name" do
    setup [:with_stack_id_from_test]

    test "uses default table when no table_name specified", %{stack_id: stack_id} do
      # This test uses the global admission control table
      # Should work without table_name option
      assert :ok = AdmissionControl.try_acquire(stack_id, :initial, max_concurrent: 100)
      assert %{initial: 1, existing: 0} = AdmissionControl.get_current(stack_id)
      assert :ok = AdmissionControl.release(stack_id, :initial)
      assert %{initial: 0, existing: 0} = AdmissionControl.get_current(stack_id)
    end
  end
end
