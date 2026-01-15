defmodule Electric.Connection.Manager.PoolTest do
  use ExUnit.Case, async: false
  use Repatch.ExUnit

  import Support.ComponentSetup

  alias Electric.Connection.Manager.Pool
  alias Electric.DbConnectionError

  @pool_role :snapshot
  setup [:with_stack_id_from_test]

  defmodule TestPostgrex do
    def start_link(_opts) do
      {:ok, spawn_link(fn -> Process.sleep(:infinity) end)}
    end
  end

  defp start_pool!(stack_id, opts) do
    pool_size = opts[:pool_size] || 2

    # Stub Postgrex.start_link so we don't connect to a real DB, but still create
    # a process linked to the pool manager (to deliver {:EXIT, pool_pid, reason}).

    child = %{
      id: {Pool, stack_id},
      start:
        {Pool, :start_link,
         [
           [
             stack_id: stack_id,
             role: @pool_role,
             pool_mod: TestPostgrex,
             pool_opts: [pool_size: pool_size],
             conn_opts: [],
             connection_manager: self()
           ]
         ]},
      restart: :temporary
    }

    pid = start_supervised!(child)
    %{pid: pid, pool_size: pool_size}
  end

  defp pool_state(stack_id) do
    stack_id
    |> Pool.name(@pool_role)
    |> :sys.get_state()
  end

  test "becomes ready and notifies connection manager when pool fills up", %{stack_id: stack_id} do
    %{pid: pool_pid} = start_pool!(stack_id, pool_size: 2)

    test_pid = self()
    # Intercept the notification to the connection manager.
    Repatch.patch(
      Electric.Connection.Manager,
      :connection_pool_ready,
      [mode: :shared],
      fn mng_pid, role, _pid ->
        send(mng_pid, {:pool_ready_notified, pool_pid, role})
        :ok
      end
    )

    Repatch.allow(test_pid, Pool.name(stack_id, @pool_role))

    state = pool_state(stack_id)
    assert state.status == :starting

    # Simulate two connections becoming connected.
    ref = state.pool_ref

    c1 = spawn_mock_conn!()
    c2 = spawn_mock_conn!()

    send(pool_pid, {:pool_conn_started, c1})
    send(pool_pid, {:pool_conn_started, c2})

    send(pool_pid, {:connected, c1, ref})
    # After first connection, still not ready
    Process.sleep(10)
    assert pool_state(stack_id).status in [:starting, :repopulating]

    send(pool_pid, {:connected, c2, ref})

    # Should transition to ready and notify
    assert_receive {:pool_ready_notified, ^pool_pid, @pool_role}, 500
    assert pool_state(stack_id).status == :ready
  end

  test "transitions to repopulating on disconnect and back to ready on reconnect", %{
    stack_id: stack_id
  } do
    %{pid: pool_pid} = start_pool!(stack_id, pool_size: 2)

    state = pool_state(stack_id)
    ref = state.pool_ref

    c1 = spawn_mock_conn!()
    c2 = spawn_mock_conn!()

    send(pool_pid, {:pool_conn_started, c1})
    send(pool_pid, {:pool_conn_started, c2})
    send(pool_pid, {:connected, c1, ref})
    send(pool_pid, {:connected, c2, ref})

    Process.sleep(10)
    assert pool_state(stack_id).status == :ready

    # One connection drops
    send(pool_pid, {:disconnected, c1, ref})
    Process.sleep(10)
    assert pool_state(stack_id).status == :repopulating

    # Reconnect
    send(pool_pid, {:connected, c1, ref})
    Process.sleep(10)
    assert pool_state(stack_id).status == :ready
  end

  test "stops with DbConnectionError when pool process is killed during startup", %{
    stack_id: stack_id
  } do
    %{pid: pool_pid} = start_pool!(stack_id, pool_size: 2)

    mon = Process.monitor(pool_pid)

    # Kill the underlying (stubbed) pool process
    state = pool_state(stack_id)
    Process.exit(state.pool_pid, :kill)

    assert_receive {:DOWN, ^mon, :process, ^pool_pid, {:shutdown, %DbConnectionError{} = reason}}

    assert reason.type == :connection_pool_failed_to_populate
    assert reason.original_error == :killed
    assert reason.retry_may_fix? == true
  end

  test "propagates last pooled-connection error when pool process is killed", %{
    stack_id: stack_id
  } do
    %{pid: pool_pid} = start_pool!(stack_id, pool_size: 2)

    # Record a last_connection_error via a child exit
    state = pool_state(stack_id)
    c1 = spawn_mock_conn!()

    send(pool_pid, {:pool_conn_started, c1})

    expected_error = %DbConnectionError{
      message: "boom",
      type: :some_error,
      original_error: :bad,
      retry_may_fix?: false
    }

    send(pool_pid, {:EXIT, c1, {:shutdown, expected_error}})

    # Now kill the pool process so the pool manager stops, using the last error above
    mon = Process.monitor(pool_pid)
    Process.exit(state.pool_pid, :kill)

    assert_receive {:DOWN, ^mon, :process, ^pool_pid, {:shutdown, ^expected_error}}
  end

  test "configure_pool_conn sends :pool_conn_started and returns opts", ctx do
    parent = self()
    opts = Electric.Utils.obfuscate_password(foo: :bar, password: "password")

    returned = Pool.configure_pool_conn(opts, parent, ctx.stack_id)
    assert returned == Electric.Utils.deobfuscate_password(opts)

    assert_receive {:pool_conn_started, pid} when is_pid(pid)
  end

  defp spawn_mock_conn! do
    start_supervised!(
      {Task, fn -> Process.sleep(:infinity) end},
      id: make_ref()
    )
  end
end
