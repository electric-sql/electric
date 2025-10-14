defmodule Electric.Postgres.LockBreakerConnectionTest do
  use ExUnit.Case, async: true
  import Support.DbSetup, except: [with_publication: 1]
  import Support.ComponentSetup

  alias Electric.Postgres.LockBreakerConnection
  alias Electric.Postgres.LockConnection

  setup [:with_unique_db, :with_stack_id_from_test, :with_slot_name]

  test "should break an abandoned lock if slot is inactive", %{
    db_config: config,
    stack_id: stack_id,
    db_conn: conn,
    slot_name: slot_name
  } do
    Postgrex.query!(
      conn,
      "SELECT pg_create_logical_replication_slot('#{slot_name}', 'pgoutput')"
    )

    {:ok, pid} =
      start_supervised(
        {LockConnection,
         connection_opts: config,
         stack_id: stack_id,
         connection_manager: self(),
         lock_name: slot_name}
      )

    ref1 = Process.monitor(pid)

    {:ok, pid} =
      start_supervised(%{
        id: :lock_breaker,
        start:
          {Electric.Postgres.LockBreakerConnection, :start,
           [[connection_opts: config, stack_id: stack_id]]}
      })

    ref2 = Process.monitor(pid)

    assert_receive {:"$gen_cast", {:lock_connection_pid_obtained, _pg_backend_pid}}
    assert_receive {:"$gen_cast", :exclusive_connection_lock_acquired}

    # Make sure we can stop the lock connection above, so we're not specifying current pid
    LockBreakerConnection.stop_backends_and_close(pid, slot_name)

    assert_receive {:DOWN, ^ref1, :process, _, _reason}
    assert_receive {:DOWN, ^ref2, :process, ^pid, _reason}
  end

  test "doesn't break the lock if it's taken from expected lock connection", %{
    db_config: config,
    stack_id: stack_id,
    db_conn: conn,
    slot_name: slot_name
  } do
    Postgrex.query!(
      conn,
      "SELECT pg_create_logical_replication_slot('#{slot_name}', 'pgoutput')"
    )

    {:ok, pid} =
      start_supervised(
        {LockConnection,
         connection_opts: config,
         stack_id: stack_id,
         connection_manager: self(),
         lock_name: slot_name}
      )

    ref1 = Process.monitor(pid)

    {:ok, pid} =
      start_supervised(%{
        id: :lock_breaker,
        start:
          {Electric.Postgres.LockBreakerConnection, :start,
           [[connection_opts: config, stack_id: stack_id]]}
      })

    ref2 = Process.monitor(pid)

    assert_receive {:"$gen_cast", {:lock_connection_pid_obtained, pg_backend_pid}}
    assert_receive {:"$gen_cast", :exclusive_connection_lock_acquired}

    LockBreakerConnection.stop_backends_and_close(pid, slot_name, pg_backend_pid)

    assert_receive {:DOWN, ^ref2, :process, ^pid, _reason}
    refute_received {:DOWN, ^ref1, :process, _, _reason}
  end
end
