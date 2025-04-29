defmodule Electric.StatusMonitorTest do
  use ExUnit.Case, async: true

  alias Electric.StatusMonitor

  setup {Support.ComponentSetup, :with_stack_id_from_test}

  describe "status/1" do
    test "when not started, returns :waiting", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when started but no signals have been received, returns :waiting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "when pg_lock_acquired has been received, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when all conditions are met, returns :active", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active
    end

    test "when replication client not ready, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when connection pool not ready, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when shape log collector not ready, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "when a process dies, it's condition is reset", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())

      test_process = self()

      process =
        Task.async(fn ->
          StatusMonitor.mark_connection_pool_ready(stack_id, self())
          send(test_process, :ready)

          receive do
            :exit -> :ok
          end

          Process.sleep(:infinity)
        end)

      receive do
        :ready -> :ok
      end

      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active

      send(process.pid, :exit)
      Task.shutdown(process)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting

      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :active
    end
  end

  describe "wait_until_active/2" do
    test "waits until all conditions are met", %{stack_id: stack_id} do
      test_process = self()
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      Task.async(fn ->
        assert StatusMonitor.wait_until_active(stack_id, 100) == :ok
        send(test_process, :active)
      end)

      start_link_supervised!({Electric.ProcessRegistry, stack_id: stack_id})
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())

      refute_receive :active, 20
      assert StatusMonitor.mark_shape_log_collector_ready(stack_id, self()) == :ok
      assert_receive :active, 20
    end

    test "returns error on timeout when process registry is not present", %{stack_id: stack_id} do
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error, "Stack ID not recognised: #{stack_id}"}
    end

    test "returns error on timeout when status monitor is not present", %{stack_id: stack_id} do
      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error, "Status monitor not found for stack ID: #{stack_id}"}
    end

    test "returns error on timeout when mark_pg_lock_acquired not received", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id})

      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error, "Timeout waiting for Postgres lock acquisition"}
    end

    test "returns error on timeout when mark_replication_client_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())

      assert {:error, "Timeout waiting for replication client to be ready" <> _} =
               StatusMonitor.wait_until_active(stack_id, 1)
    end

    test "returns error on timeout when mark_connection_pool_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())

      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error, "Timeout waiting for database connection pool to be ready"}
    end

    test "returns error on timeout when mark_shape_log_collector_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())

      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error, "Timeout waiting for shape data to be loaded"}
    end

    test "returns explicit error on timeout when supplied", %{
      stack_id: stack_id
    } do
      error_message = "Some error message"

      start_link_supervised!({StatusMonitor, stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_as_errored(stack_id, error_message)

      assert StatusMonitor.wait_until_active(stack_id, 1) ==
               {:error,
                "Timeout waiting for database connection pool to be ready: #{error_message}"}
    end
  end
end
