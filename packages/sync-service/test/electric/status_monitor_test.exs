defmodule Electric.StatusMonitorTest do
  use ExUnit.Case, async: true

  alias Electric.StatusMonitor

  setup {Support.ComponentSetup, :with_stack_id_from_test}

  describe "status/1" do
    test "when not started, returns :waiting", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when started but no signals have been received, returns :waiting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when pg_lock_acquired has been received, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when all conditions are met, returns :active", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active
    end

    test "when replication client not ready, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when connection pool not ready, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when shape log collector not ready, returns :starting", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when a process dies, it's condition is reset", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())

      test_process = self()

      process =
        Task.async(fn ->
          StatusMonitor.mark_connection_pool_ready(stack_id, self())
          send(test_process, :ready)

          receive do
            :exit -> :ok
          end
        end)

      receive do
        :ready -> :ok
      end

      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active

      send(process.pid, :exit)
      stop_process(process.pid)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting

      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active
    end
  end

  describe "wait_until_active/2" do
    test "waits until all conditions are met", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      test_process = self()

      Task.async(fn ->
        StatusMonitor.wait_until_active(stack_id)
        send(test_process, :active)
      end)

      refute_receive :active, 20
      assert StatusMonitor.mark_shape_log_collector_ready(stack_id, self()) == :ok
      assert_receive :active, 20
    end

    test "returns error on timeout", %{stack_id: stack_id} do
      start_supervised!({StatusMonitor, stack_id})
      assert StatusMonitor.wait_until_active(stack_id, 1) == {:error, :timeout}
    end
  end

  defp stop_process(pid) do
    Process.unlink(pid)
    Process.monitor(pid)
    Process.exit(pid, :kill)

    receive do
      {:DOWN, _, :process, ^pid, _} -> :process_killed
    after
      500 -> raise "#{inspect(pid)} process not killed"
    end
  end
end
