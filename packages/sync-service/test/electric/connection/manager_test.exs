defmodule Electric.Connection.ConnectionManagerTest do
  use ExUnit.Case
  use Repatch.ExUnit

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

    replication_connection_opts = Map.get(ctx, :replication_connection_opts, ctx.db_config)

    replication_opts = [
      stack_id: stack_id,
      connection_opts: replication_connection_opts,
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
         pool_opts: [pool_size: 2],
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
          Connection.Manager.Supervisor.name(stack_id: stack_id),
          Connection.Manager
        )

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) == :waiting
    end

    test "backtracks the status when the shape log collector goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      :ok = GenServer.stop(Electric.Replication.ShapeLogCollector.name(stack_id), :shutdown)

      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) in [:waiting, :starting]
    end

    test "backtracks the status when the shape cache goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      # should backtrack the status by virtue of the shape log collector being shut down
      # by the replication supervisor
      monitor =
        stack_id
        |> Electric.Replication.ShapeLogCollector.name()
        |> GenServer.whereis()
        |> Process.monitor()

      :ok = GenServer.stop(Electric.ShapeCache.name(stack_id), :shutdown)

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}

      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) in [:waiting, :starting]
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

    test "manager dies after replication supervisor death", ctx do
      %{stack_id: stack_id} = ctx

      wait_until_active(stack_id)

      supervisor_pid = stack_id |> Electric.Replication.Supervisor.name() |> GenServer.whereis()
      assert Process.alive?(supervisor_pid)

      manager_pid = GenServer.whereis(Electric.Connection.Manager.name(stack_id))
      ref = Process.monitor(manager_pid)

      Supervisor.stop(supervisor_pid, :reason)

      # When the Replication.Supervisor process exits (for whatever reason)
      # Connection.Manager.Supervisor terminates the rest of its children and shuts down itself
      # (thanks to [auto_shutdown: :any_significant]).  This is why Connection.Manager exits
      # with reason :shutdown and is then restarted by Connection.Supervsior under
      # Connection.Manager.Supervisor again.
      assert_receive {:DOWN, ^ref, :process, ^manager_pid, :shutdown}
    end
  end

  describe "cleanup procedure" do
    setup [:start_connection_manager]

    test "handles dropping slot on termination", ctx do
      %{
        db_conn: db_conn,
        stack_id: stack_id,
        connection_opts: connection_opts,
        replication_opts: replication_opts
      } = ctx

      wait_until_active(stack_id)

      manager_pid = GenServer.whereis(Electric.Connection.Manager.name(stack_id))
      :ok = Electric.Connection.Manager.drop_replication_slot_on_stop(manager_pid)

      :ok =
        Supervisor.terminate_child(
          Connection.Manager.Supervisor.name(stack_id: stack_id),
          Connection.Manager
        )

      # Ensure the replication slot has been dropped
      assert %{rows: []} =
               Postgrex.query!(
                 db_conn,
                 "SELECT slot_name FROM pg_replication_slots where database = $1",
                 [connection_opts[:database]]
               )

      # Ensure the publication has been dropped
      assert %{rows: []} =
               Postgrex.query!(
                 db_conn,
                 "SELECT pubname FROM pg_publication WHERE pubname = $1",
                 [replication_opts[:publication_name]]
               )
    end
  end

  describe "pooled connection opts" do
    setup(ctx) do
      [replication_connection_opts: Keyword.put(ctx.db_config, :host, "unpooled.localhost")]
    end

    test "are used correctly", %{stack_id: stack_id} = ctx do
      %{replication_connection_opts: repl_opts, db_config: pooled_conn_opts} = ctx

      parent = self()

      refute repl_opts == pooled_conn_opts

      Repatch.patch(
        Connection.Manager.ConnectionResolver,
        :validate,
        [mode: :shared],
        fn _stack_id, conn_opts ->
          send(parent, {:validate, conn_opts})

          {:ok, conn_opts}
        end
      )

      # process allowance doesn't follow the supervision tree in this case
      spawn_link(fn ->
        Stream.repeatedly(fn -> 0 end)
        |> Enum.reduce_while(0, fn _, _ ->
          case GenServer.whereis(Electric.Connection.Manager.name(stack_id)) do
            nil ->
              {:cont, 0}

            pid ->
              Repatch.allow(parent, pid)
              {:halt, 0}
          end
        end)
      end)

      start_connection_manager(ctx)

      StatusMonitor.wait_until_active(stack_id, 1000)

      assert_receive {:validate, ^pooled_conn_opts}
      assert_receive {:validate, ^repl_opts}
    end
  end

  describe "pool_sizes/1" do
    test "uses the given pool size for both if size is small" do
      # we need a pool size of at least 2
      assert %{admin: 1, snapshot: 1} =
               Electric.Connection.Manager.pool_sizes(1)

      assert %{admin: 1, snapshot: 1} =
               Electric.Connection.Manager.pool_sizes(2)

      assert %{admin: 1, snapshot: 3} =
               Electric.Connection.Manager.pool_sizes(4)

      assert %{admin: 1, snapshot: 5} =
               Electric.Connection.Manager.pool_sizes(6)

      assert %{admin: 2, snapshot: 8} =
               Electric.Connection.Manager.pool_sizes(10)
    end

    test "splits the pool between both roles for large enough sizes" do
      assert %{admin: 4, snapshot: 16} =
               Electric.Connection.Manager.pool_sizes(20)

      assert %{admin: 4, snapshot: 36} =
               Electric.Connection.Manager.pool_sizes(40)

      assert %{admin: 4, snapshot: 96} =
               Electric.Connection.Manager.pool_sizes(100)
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
