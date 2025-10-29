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

      # Should receive telemetry event
      assert_receive {:telemetry_acquire, [:electric, :admission_control, :acquire], measurements,
                      metadata}

      assert measurements.count == 1
      assert measurements.current == 1
      assert metadata.stack_id == stack_id
      assert metadata.kind == :initial
      assert metadata.limit == 10

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

      # Should receive telemetry event
      assert_receive {:telemetry_reject, [:electric, :admission_control, :reject], measurements,
                      metadata}

      assert measurements.count == 1
      assert metadata.stack_id == stack_id
      assert metadata.kind == :initial
      assert metadata.reason == :overloaded
      assert metadata.current == 3
      assert metadata.limit == 2

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
