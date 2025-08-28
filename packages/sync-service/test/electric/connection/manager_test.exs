defmodule Electric.Connection.ConnectionManagerTest do
  use ExUnit.Case

  import Support.ComponentSetup
  import Support.DbSetup

  alias Electric.Connection
  alias Electric.StatusMonitor

  setup [
    :with_unique_db,
    :with_stack_id_from_test,
    :with_persistent_kv,
    :with_inspector,
    :with_slot_name_and_stream_id,
    :with_in_memory_storage
  ]

  defp start_connection_manager(%{stack_id: stack_id} = ctx) do
    stack_events_registry = Electric.stack_events_registry()
    publication_name = "electric_conn_mgr_test_pub_#{:erlang.phash2(stack_id)}"
    connection_opts = ctx.db_config

    replication_opts = [
      stack_id: stack_id,
      connection_opts: ctx.db_config,
      slot_name: ctx.slot_name,
      publication_name: publication_name,
      try_creating_publication?: true,
      slot_temporary?: true,
      transaction_received: nil,
      relation_received: nil
    ]

    conn_sup =
      start_link_supervised!(
        {Connection.Supervisor,
         stack_id: stack_id,
         connection_opts: connection_opts,
         replication_opts: replication_opts,
         pool_opts: [name: Electric.Connection.Manager.pool_name(stack_id), pool_size: 2],
         timeline_opts: [stack_id: stack_id, persistent_kv: ctx.persistent_kv],
         shape_cache_opts: [
           stack_id: stack_id,
           inspector: ctx.inspector,
           shape_status:
             {Electric.ShapeCache.ShapeStatus,
              Electric.ShapeCache.ShapeStatus.opts(
                storage: ctx.storage,
                shape_meta_table: Electric.ShapeCache.ShapeStatus.shape_meta_table(stack_id)
              )},
           log_producer: Electric.Replication.ShapeLogCollector.name(stack_id),
           consumer_supervisor: Electric.Shapes.DynamicConsumerSupervisor.name(stack_id),
           storage: ctx.storage,
           publication_manager: {Electric.Replication.PublicationManager, stack_id: stack_id},
           chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
           registry: Electric.StackSupervisor.registry_name(stack_id)
         ],
         tweaks: [],
         persistent_kv: ctx.persistent_kv,
         stack_events_registry: stack_events_registry},
        # The test supervisor under which this one is started has `auto_shutdown` set to
        # `:never`, so we need to make sure the connection supervisor is not a significant
        # child, otherwise we'd get the following error:
        #
        #     ** (RuntimeError) failed to start child with the spec {Electric.Connection.Supervisor, [...]}.
        #      Reason: bad child specification, got: {:bad_combination, [auto_shutdown: :never, significant: true]}
        significant: false
      )

    Registry.register(stack_events_registry, {:stack_status, stack_id}, nil)

    %{conn_sup: conn_sup, connection_opts: connection_opts, replication_opts: replication_opts}
  end

  describe "status monitor" do
    setup [:start_connection_manager]

    test "reports status=waiting initially", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "reports status=starting once the exclusive connection lock is acquired", %{
      stack_id: stack_id
    } do
      assert_receive {:stack_status, _, :waiting_for_connection_lock}
      assert_receive {:stack_status, _, :connection_lock_acquired}
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == :starting
    end

    test "reports status=active when all connection processes are running", %{stack_id: stack_id} do
      wait_until_active(stack_id)
    end

    test "backtracks the status when the replication client goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      monitor = monitor_replication_client(stack_id)

      :ok = GenServer.stop(Electric.Postgres.ReplicationClient.name(stack_id), :shutdown)

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) in [:waiting, :starting]
    end

    test "resets the status when connection manager goes down", %{stack_id: stack_id} = ctx do
      wait_until_active(stack_id)

      # Start another lock process so that when ConnectionManager exits it is not able to restore its readiness immediately.
      new_stack_id = stack_id <> "_new"
      _registry = start_link_supervised!({Electric.ProcessRegistry, stack_id: new_stack_id})

      lock_opts = [
        connection_opts: ctx.connection_opts,
        connection_manager: self(),
        lock_name: Keyword.fetch!(ctx.replication_opts, :slot_name),
        stack_id: new_stack_id
      ]

      start_supervised!(%{
        id: :alt_lock,
        start: {Electric.Postgres.LockConnection, :start_link, [lock_opts]}
      })

      monitor = monitor_replication_client(stack_id)

      :ok =
        Supervisor.terminate_child(
          Connection.Supervisor.name(stack_id: stack_id),
          Connection.Manager
        )

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) == :waiting
    end
  end

  describe "process dependencies" do
    setup [:start_connection_manager]

    # https://github.com/electric-sql/electric/issues/3018
    test "handles status messages after shape cache restart", ctx do
      %{stack_id: stack_id} = ctx

      wait_until_active(stack_id)

      shape_cache_pid = stack_id |> Electric.ShapeCache.name() |> GenServer.whereis()
      assert Process.alive?(shape_cache_pid)

      manager_pid = GenServer.whereis(Electric.Connection.Manager.name(stack_id))
      ref = Process.monitor(manager_pid)

      Process.exit(shape_cache_pid, {:error, :reason})

      refute_receive {:DOWN, ^ref, :process, ^manager_pid, _reason}, 300
    end
  end

  defp wait_until_active(stack_id) do
    assert_receive {:stack_status, _, :waiting_for_connection_lock}
    assert_receive {:stack_status, _, :connection_lock_acquired}
    assert_receive {:stack_status, _, :ready}
    StatusMonitor.wait_until_active(stack_id, 1000)
    assert StatusMonitor.status(stack_id) == :active
  end

  defp monitor_replication_client(stack_id) do
    stack_id
    |> Electric.Postgres.ReplicationClient.name()
    |> GenServer.whereis()
    |> Process.monitor()
  end
end
