defmodule Electric.Connection.ConnectionManagerTest do
  use ExUnit.Case
  use Repatch.ExUnit

  import Support.ComponentSetup
  import Support.DbSetup

  alias Electric.Replication.ShapeLogCollector
  alias Electric.Connection
  alias Electric.StatusMonitor

  @moduletag :tmp_dir

  setup [
    :with_unique_db,
    :with_stack_id_from_test,
    :with_status_monitor,
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
      slot_temporary?: Map.get(ctx, :slot_temporary?, true),
      handle_event: nil
    ]

    connection_manager_opts = [
      stack_id: stack_id,
      connection_opts: connection_opts,
      replication_opts: replication_opts,
      pool_opts: [pool_size: 2],
      connection_backoff: Connection.Manager.ConnectionBackoff.init(50, 50),
      timeline_opts: [stack_id: stack_id, persistent_kv: ctx.persistent_kv],
      inspector: ctx.inspector,
      shape_cache_opts: [
        stack_id: stack_id
      ],
      tweaks: [],
      max_shapes: nil,
      persistent_kv: ctx.persistent_kv,
      stack_events_registry: stack_events_registry,
      lock_breaker_guard: ctx[:lock_breaker_guard]
    ]

    core_sup =
      start_link_supervised!(
        {Electric.CoreSupervisor,
         stack_id: stack_id, connection_manager_opts: connection_manager_opts},
        # The test supervisor under which this one is started has `auto_shutdown` set to
        # `:never`, so we need to make sure the core supervisor is not a significant
        # child, otherwise we'd get the following error:
        #
        #     ** (RuntimeError) failed to start child with the spec {Electric.CoreSupervisor, [...]}.
        #      Reason: bad child specification, got: {:bad_combination, [auto_shutdown: :never, significant: true]}
        significant: false
      )

    Registry.register(stack_events_registry, {:stack_status, stack_id}, nil)

    %{conn_sup: core_sup, connection_opts: connection_opts, replication_opts: replication_opts}
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

      test_pid = self()

      start_supervised!({
        Task,
        fn ->
          DBConnection.run(ctx.db_conn, fn conn ->
            Postgrex.query!(
              conn,
              "SELECT pg_advisory_lock(hashtext('#{ctx.slot_name}'))",
              []
            )

            send(test_pid, :test_lock_acquired)

            Process.sleep(:infinity)
          end)
        end
      })

      monitor = monitor_replication_client(stack_id)

      :ok =
        Supervisor.terminate_child(
          Connection.Manager.Supervisor.name(stack_id),
          Connection.Manager
        )

      assert_receive {:DOWN, ^monitor, :process, _pid, :shutdown}
      assert_receive :test_lock_acquired
      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      assert StatusMonitor.status(stack_id) == %{conn: :waiting_on_lock, shape: :up}
    end

    test "backtracks the status when the shape log collector goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      :ok = GenServer.stop(ShapeLogCollector.name(stack_id), :shutdown)

      StatusMonitor.wait_for_messages_to_be_processed(stack_id)

      status = StatusMonitor.status(stack_id)
      assert status.shape == :starting
    end

    test "backtracks the status when the shape cache goes down", %{stack_id: stack_id} do
      wait_until_active(stack_id)

      # should backtrack the status by virtue of the shape log collector being shut down
      # by the replication supervisor
      monitor = Electric.Replication.ShapeLogCollector.monitor(stack_id)

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
        |> Electric.Shapes.Supervisor.canary_name()
        |> GenServer.whereis()
        |> Process.monitor()

      :ok = GenServer.stop(Electric.Shapes.Supervisor.canary_name(stack_id), :shutdown)

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

    @tag slot_temporary?: false
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
          Connection.Manager.Supervisor.name(stack_id),
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
              :ok = Supervisor.stop(Connection.Manager.Supervisor.name(ctx.stack_id))
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
              :ok = Supervisor.stop(Connection.Manager.Supervisor.name(ctx.stack_id))
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

  describe "lock_breaker_guard" do
    test "skips lock breaker when guard returns false", ctx do
      test_pid = self()

      # Hold the advisory lock so the manager stays in acquiring_lock state
      start_supervised!({
        Task,
        fn ->
          DBConnection.run(ctx.db_conn, fn conn ->
            Postgrex.query!(
              conn,
              "SELECT pg_advisory_lock(hashtext('#{ctx.slot_name}'))",
              []
            )

            send(test_pid, :lock_held)
            Process.sleep(:infinity)
          end)
        end
      })

      assert_receive :lock_held

      start_connection_manager(Map.put(ctx, :lock_breaker_guard, fn -> false end))

      # Wait for lock acquisition to start
      assert_receive {:stack_status, _, :waiting_for_connection_lock}, 5000

      manager_pid = GenServer.whereis(Connection.Manager.name(ctx.stack_id))

      # Wait for pg_info_obtained to be processed (sets replication_pg_backend_pid)
      %{replication_lock_timer: tref} = wait_for_pg_backend_pid(manager_pid)
      assert not is_nil(tref)

      :erlang.cancel_timer(tref)

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          send(manager_pid, {:timeout, tref, {:check_status, :replication_lock}})
          :pong = Connection.Manager.ping(manager_pid)
        end)

      assert log =~ "Lock breaker skipped"
    end

    test "allows lock breaker when no guard is set", ctx do
      test_pid = self()

      # Hold the advisory lock so the manager stays in acquiring_lock state
      start_supervised!({
        Task,
        fn ->
          DBConnection.run(ctx.db_conn, fn conn ->
            Postgrex.query!(
              conn,
              "SELECT pg_advisory_lock(hashtext('#{ctx.slot_name}'))",
              []
            )

            send(test_pid, :lock_held)
            Process.sleep(:infinity)
          end)
        end
      })

      assert_receive :lock_held

      start_connection_manager(ctx)

      # Wait for lock acquisition to start
      assert_receive {:stack_status, _, :waiting_for_connection_lock}, 5000

      manager_pid = GenServer.whereis(Connection.Manager.name(ctx.stack_id))

      # Wait for pg_info_obtained to be processed (sets replication_pg_backend_pid)
      %{replication_lock_timer: tref} = wait_for_pg_backend_pid(manager_pid)

      assert not is_nil(tref)

      :erlang.cancel_timer(tref)

      log =
        ExUnit.CaptureLog.capture_log(fn ->
          send(manager_pid, {:timeout, tref, {:check_status, :replication_lock}})
          :pong = Connection.Manager.ping(manager_pid)
        end)

      # Without a guard, the lock breaker should attempt to run (no "skipped" message)
      refute log =~ "Lock breaker skipped"
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

  defp wait_for_pg_backend_pid(manager_pid, attempts \\ 100) do
    state = :sys.get_state(manager_pid)

    if is_nil(state.replication_pg_backend_pid) and attempts > 0 do
      Process.sleep(10)
      wait_for_pg_backend_pid(manager_pid, attempts - 1)
    else
      state
    end
  end
end
