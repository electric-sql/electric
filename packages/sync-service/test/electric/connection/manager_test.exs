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
    :with_slot_name,
    :with_in_memory_storage,
    :with_shape_status
  ]

  defp start_connection_manager(%{stack_id: stack_id} = ctx) do
    stack_events_registry = Electric.stack_events_registry()
    publication_name = "electric_conn_mgr_test_pub_#{:erlang.phash2(stack_id)}"
    connection_opts = Map.get(ctx, :pooled_connection_opts, ctx.db_config)

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
         connection_backoff: Connection.Manager.ConnectionBackoff.init(50, 50),
         timeline_opts: [stack_id: stack_id, persistent_kv: ctx.persistent_kv],
         shape_cache_opts: [
           stack_id: stack_id,
           inspector: ctx.inspector,
           consumer_supervisor: Electric.Shapes.DynamicConsumerSupervisor.name(stack_id),
           storage: ctx.storage,
           publication_manager: {Electric.Replication.PublicationManager, stack_id: stack_id},
           chunk_bytes_threshold: Electric.ShapeCache.LogChunker.default_chunk_size_threshold(),
           registry: Electric.StackSupervisor.registry_name(stack_id)
         ],
         tweaks: [],
         max_shapes: nil,
         expiry_batch_size: 1,
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

  defp unresponsive_port(_ctx) do
    {:ok, socket} = :gen_tcp.listen(0, [])
    {:ok, port} = :inet.port(socket)
    [unresponsive_port: port]
  end

  describe "status monitor" do
    setup [:start_connection_manager]

    test "reports status=waiting initially", %{stack_id: stack_id} do
      assert StatusMonitor.status(stack_id) == %{conn: :waiting_on_lock, shape: :starting}
    end

    test "reports status=starting once the exclusive connection lock is acquired", %{
      stack_id: stack_id
    } do
      assert_receive {:stack_status, _, :waiting_for_connection_lock}
      assert_receive {:stack_status, _, :connection_lock_acquired}
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)
      assert StatusMonitor.status(stack_id) == %{conn: :starting, shape: :starting}
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

      status = StatusMonitor.status(stack_id)
      assert status.conn in [:waiting_on_lock, :starting]
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

      assert StatusMonitor.status(stack_id) == %{conn: :waiting_on_lock, shape: :up}
    end

    test "backtracks the status when the shape log collector goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      :ok = GenServer.stop(Electric.Replication.ShapeLogCollector.name(stack_id), :shutdown)

      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      status = StatusMonitor.status(stack_id)
      assert status.shape == :starting
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

      status = StatusMonitor.status(stack_id)
      assert status.shape == :starting
    end

    test "backtracks the status when the canary goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      # should backtrack the status by virtue of the shape log collector being shut down
      # by the replication supervisor
      monitor =
        stack_id
        |> Electric.Replication.Supervisor.canary_name()
        |> GenServer.whereis()
        |> Process.monitor()

      :ok = GenServer.stop(Electric.Replication.Supervisor.canary_name(stack_id), :shutdown)

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}

      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      status = StatusMonitor.status(stack_id)
      assert status.shape == :starting
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

  describe "invalid pool configuration" do
    setup [:unresponsive_port]

    setup(ctx) do
      [
        pooled_connection_opts:
          Keyword.merge(ctx.db_config, port: ctx.unresponsive_port, timeout: 100)
      ]
    end

    setup [:start_connection_manager]

    test "failure to get pooled connection results in retries", ctx do
      %{stack_id: stack_id} = ctx

      ref = Process.monitor(GenServer.whereis(Electric.Connection.Manager.name(stack_id)))

      refute_receive {:DOWN, ^ref, :process, _pid, _reason}, 1000
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

  describe "shutdown" do
    setup [:unresponsive_port]

    test "manager blocked resolving a replication connection terminates cleanly", ctx do
      start_connection_manager(
        Map.merge(ctx, %{
          replication_connection_opts: Keyword.put(ctx.db_config, :port, ctx.unresponsive_port)
        })
      )

      {time, log} =
        :timer.tc(
          fn ->
            ExUnit.CaptureLog.capture_log(fn ->
              :ok = Supervisor.stop(Connection.Manager.Supervisor.name(stack_id: ctx.stack_id))
            end)
          end,
          :millisecond
        )

      assert time < 1000
      refute log =~ "Electric.DBConnection unknown error"
    end

    test "manager blocked resolving a pool connection terminates cleanly", ctx do
      start_connection_manager(
        Map.merge(ctx, %{
          pooled_connection_opts: Keyword.put(ctx.db_config, :port, ctx.unresponsive_port)
        })
      )

      assert_receive {:stack_status, _, :connection_lock_acquired}, 1000

      {time, log} =
        :timer.tc(
          fn ->
            ExUnit.CaptureLog.capture_log(fn ->
              :ok = Supervisor.stop(Connection.Manager.Supervisor.name(stack_id: ctx.stack_id))
            end)
          end,
          :millisecond
        )

      assert time < 1000
      refute log =~ "Electric.DBConnection unknown error"
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

      StatusMonitor.wait_until_active(stack_id, timeout: 1000)

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
    StatusMonitor.wait_until_active(stack_id, timeout: 1000)
    assert StatusMonitor.status(stack_id) == %{conn: :up, shape: :up}
  end

  defp monitor_replication_client(stack_id) do
    stack_id
    |> Electric.Postgres.ReplicationClient.name()
    |> GenServer.whereis()
    |> Process.monitor()
  end
end
