defmodule Electric.StatusMonitorTest do
  use ExUnit.Case, async: true

  alias Electric.StatusMonitor
  import Support.TestUtils, only: [set_status_to_active: 1]

  setup {Support.ComponentSetup, :with_stack_id_from_test}

  describe "service_status/1" do
    test "returns :starting before any conditions are met", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      assert StatusMonitor.service_status(stack_id) == :starting
    end

    test "returns :starting when conn is waiting but shapes not loaded", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      # pg_lock_acquired is not set, so conn is :waiting_on_lock, but shape is :starting
      assert StatusMonitor.service_status(stack_id) == :starting
    end

    test "returns :waiting when conn waiting on lock and shapes loaded", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.service_status(stack_id) == :waiting
    end

    test "returns :starting when conn is progressing even with shapes loaded", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      # conn is :starting (not all conn conditions met), shape is :read_only
      # This is a transient startup state — should NOT return :waiting
      assert StatusMonitor.service_status(stack_id) == :starting
    end

    test "returns :starting when conn is up but shape pipeline not ready", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      # conn is :up, shape is :read_only (log collector + supervisor not ready)
      # This is a transient post-lock state — should return :starting, not :waiting
      assert StatusMonitor.service_status(stack_id) == :starting
    end

    test "returns :active when fully operational", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      set_status_to_active(%{stack_id: stack_id})

      assert StatusMonitor.service_status(stack_id) == :active
    end

    test "returns :sleeping when connections scaled down", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.database_connections_going_to_sleep(stack_id)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.service_status(stack_id) == :sleeping
    end
  end

  describe "status/1" do
    test "when not started, returns :waiting_on_lock", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == %{conn: :waiting_on_lock, shape: :starting}
    end

    test "when started but no signals have been received, returns :waiting_on_lock", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      assert StatusMonitor.status(stack_id) == %{conn: :waiting_on_lock, shape: :starting}
    end

    test "when pg_lock_acquired has been received, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :starting}
    end

    test "when all conditions are met, returns :up", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :up}
    end

    test "when integrety checks not passed, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :up}
    end

    test "when replication client not ready, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :up}
    end

    test "when connection pool not ready, returns :starting", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :up}
    end

    test "when shape log collector not ready, shape returns :read_only", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :read_only}
    end

    test "when canary process not ready, shape returns :read_only", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :read_only}
    end

    test "when a process dies, it's condition is reset", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())

      test_process = self()

      process =
        Task.async(fn ->
          StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
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
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :up}

      send(process.pid, :exit)
      Task.shutdown(process)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :up}

      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :up}
    end
  end

  describe "wait_until_active/2" do
    test "waits until all conditions are met", %{stack_id: stack_id} do
      test_process = self()
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      Task.async(fn ->
        assert StatusMonitor.wait_until_active(stack_id, timeout: 100) == :ok
        send(test_process, :active)
      end)

      start_link_supervised!({Electric.ProcessRegistry, stack_id: stack_id})
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())

      refute_receive :active, 20
      assert StatusMonitor.mark_shape_log_collector_ready(stack_id, self()) == :ok
      assert_receive :active, 100
    end

    test "allows timeout: :infinity", %{stack_id: stack_id} do
      test_process = self()
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      Task.async(fn ->
        assert StatusMonitor.wait_until_active(stack_id, timeout: :infinity) == :ok
        send(test_process, :active)
      end)

      start_link_supervised!({Electric.ProcessRegistry, stack_id: stack_id})
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())

      refute_receive :active, 20
      assert StatusMonitor.mark_shape_log_collector_ready(stack_id, self()) == :ok
      assert_receive :active, 100
    end

    test "returns error on timeout when process registry is not present", %{stack_id: stack_id} do
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Stack ID not recognised: #{stack_id}"}
    end

    test "returns error on timeout when status monitor is not present", %{stack_id: stack_id} do
      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Status monitor not found for stack ID: #{stack_id}"}
    end

    test "returns error on timeout when mark_pg_lock_acquired not received", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Timeout waiting for Postgres lock acquisition"}
    end

    test "returns error on timeout when mark_replication_client_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())

      assert {:error, "Timeout waiting for replication client to be ready" <> _} =
               StatusMonitor.wait_until_active(stack_id, timeout: 1)
    end

    test "returns error on timeout when metadata mark_connection_pool_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Timeout waiting for database connection pool (metadata) to be ready"}
    end

    test "returns error on timeout when snapshot mark_connection_pool_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Timeout waiting for database connection pool (snapshot) to be ready"}
    end

    test "returns error on timeout when mark_shape_log_collector_ready not received", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Timeout waiting for shape data to be loaded"}
    end

    test "returns error on timeout waiting for integrety checks", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error, "Timeout waiting for integrety checks"}
    end

    test "returns explicit error on timeout when supplied", %{
      stack_id: stack_id
    } do
      error_message = "Some error message"

      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_connection_pool_as_errored(stack_id, :snapshot, error_message)

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) ==
               {:error,
                "Timeout waiting for database connection pool (snapshot) to be ready: #{error_message}"}
    end

    test "returns :conn_sleeping when connections are sleeping", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.database_connections_going_to_sleep(stack_id)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.wait_until_active(stack_id, timeout: 1) == :conn_sleeping
    end

    test "returns error if stack is terminated before fully initialized", %{stack_id: stack_id} do
      parent = self()

      {:via, mod, name} = StatusMonitor.name(stack_id)

      pid =
        start_supervised!(
          {Task,
           fn ->
             mod.register_name(name, self())

             send(parent, {:monitor, :ready})

             Process.sleep(:infinity)
           end}
        )

      assert_receive {:monitor, :ready}, 200

      task =
        Task.async(fn ->
          send(parent, {:monitor, :wait})
          StatusMonitor.wait_until_active(stack_id, timeout: 100)
        end)

      ref = Process.monitor(pid)

      assert_receive {:monitor, :wait}, 200

      Process.exit(
        pid,
        Enum.random([:shutdown, {:shutdown, :normal}, {:error, "broken"}, :kill])
      )

      assert_receive {:DOWN, ^ref, :process, ^pid, _}, 200

      # the actual returned error is caused by the status monitor pid not
      # existing, not by the exit message
      assert {:error, _message} = Task.await(task, 1_000)
    end
  end

  describe "wait_until/3" do
    test "with :read_only returns {:ok, :active} when fully active", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      set_status_to_active(%{stack_id: stack_id})

      assert StatusMonitor.wait_until(stack_id, :read_only, timeout: 100) == {:ok, :active}
    end

    test "with :read_only returns {:ok, :read_only} when shape metadata is ready", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.wait_until(stack_id, :read_only, timeout: 100) == {:ok, :read_only}
    end

    test "with :read_only waits until shape metadata becomes ready", %{stack_id: stack_id} do
      test_process = self()

      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      Task.async(fn ->
        result = StatusMonitor.wait_until(stack_id, :read_only, timeout: 500)
        send(test_process, {:result, result})
      end)

      refute_receive {:result, _}, 50
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      assert_receive {:result, {:ok, :read_only}}, 200
    end

    test "with :active returns {:ok, :active} when fully active", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      set_status_to_active(%{stack_id: stack_id})

      assert StatusMonitor.wait_until(stack_id, :active, timeout: 100) == {:ok, :active}
    end

    test "with :active waits and does not return for :read_only", %{stack_id: stack_id} do
      test_process = self()

      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      Task.async(fn ->
        result = StatusMonitor.wait_until(stack_id, :active, timeout: 100)
        send(test_process, {:result, result})
      end)

      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      # Should not return for read_only — must wait for active
      refute_receive {:result, {:ok, :read_only}}, 50
      assert_receive {:result, {:error, _}}, 200
    end

    test "with :active waits until all conditions are met", %{stack_id: stack_id} do
      test_process = self()
      stop_supervised!(Electric.ProcessRegistry.registry_name(stack_id))

      Task.async(fn ->
        result = StatusMonitor.wait_until(stack_id, :active, timeout: 500)
        send(test_process, {:result, result})
      end)

      start_link_supervised!({Electric.ProcessRegistry, stack_id: stack_id})
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_pg_lock_acquired(stack_id, self())
      StatusMonitor.mark_replication_client_ready(stack_id, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :admin, self())
      StatusMonitor.mark_connection_pool_ready(stack_id, :snapshot, self())
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.mark_supervisor_processes_ready(stack_id, self())
      StatusMonitor.mark_integrety_checks_passed(stack_id, self())

      refute_receive {:result, _}, 20
      StatusMonitor.mark_shape_log_collector_ready(stack_id, self())
      assert_receive {:result, {:ok, :active}}, 200
    end

    test "returns :conn_sleeping when connections are sleeping", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.database_connections_going_to_sleep(stack_id)
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.wait_until(stack_id, :read_only, timeout: 100) == :conn_sleeping
      assert StatusMonitor.wait_until(stack_id, :active, timeout: 100) == :conn_sleeping
    end

    test "returns error on timeout", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      assert {:error, _} = StatusMonitor.wait_until(stack_id, :read_only, timeout: 1)
      assert {:error, _} = StatusMonitor.wait_until(stack_id, :active, timeout: 1)
    end
  end

  describe "wait_until_async/2" do
    test "replies immediately when already active", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      set_status_to_active(%{stack_id: stack_id})

      ref = StatusMonitor.wait_until_async(stack_id, :active)
      assert_receive {{StatusMonitor, ^ref}, {:ok, :active}}, 100
    end

    test "replies immediately with :read_only when shape metadata is ready", %{
      stack_id: stack_id
    } do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      ref = StatusMonitor.wait_until_async(stack_id, :read_only)
      assert_receive {{StatusMonitor, ^ref}, {:ok, :read_only}}, 100
    end

    test "notifies when status transitions to active", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      ref = StatusMonitor.wait_until_async(stack_id, :active)
      refute_receive {{StatusMonitor, ^ref}, _}, 50

      set_status_to_active(%{stack_id: stack_id})
      assert_receive {{StatusMonitor, ^ref}, {:ok, :active}}, 100
    end

    test "does not notify :active waiter for :read_only transition", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      ref = StatusMonitor.wait_until_async(stack_id, :active)

      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      refute_receive {{StatusMonitor, ^ref}, _}, 50
    end

    test "notifies :read_only waiter when shape metadata becomes ready", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      ref = StatusMonitor.wait_until_async(stack_id, :read_only)
      refute_receive {{StatusMonitor, ^ref}, _}, 50

      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      assert_receive {{StatusMonitor, ^ref}, {:ok, :read_only}}, 100
    end

    test "supports multiple concurrent waiters at different levels", %{stack_id: stack_id} do
      start_link_supervised!({StatusMonitor, stack_id: stack_id})

      ref_ro = StatusMonitor.wait_until_async(stack_id, :read_only)
      ref_active = StatusMonitor.wait_until_async(stack_id, :active)

      # Transition to read_only — only the read_only waiter should be notified
      StatusMonitor.mark_shape_metadata_ready(stack_id, self())
      assert_receive {{StatusMonitor, ^ref_ro}, {:ok, :read_only}}, 100
      refute_receive {{StatusMonitor, ^ref_active}, _}, 50

      # Transition to active — the active waiter should be notified
      set_status_to_active(%{stack_id: stack_id})
      assert_receive {{StatusMonitor, ^ref_active}, {:ok, :active}}, 100
    end
  end
end
