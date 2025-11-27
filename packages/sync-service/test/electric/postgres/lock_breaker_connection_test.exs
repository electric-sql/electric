defmodule Electric.Postgres.LockBreakerConnectionTest do
  use ExUnit.Case, async: true
  import Support.DbSetup, except: [with_publication: 1]
  import Support.ComponentSetup

  alias Electric.Postgres.LockBreakerConnection
  alias Electric.Postgres.ReplicationClient

  setup [
    :with_unique_db,
    :with_stack_id_from_test,
    :with_lsn_tracker,
    :with_slot_name
  ]

  test "should break an abandoned lock if slot is inactive", ctx do
    Postgrex.query!(
      ctx.db_conn,
      "SELECT pg_create_logical_replication_slot('#{ctx.slot_name}', 'pgoutput')"
    )

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

          send(test_pid, :lock_acquired)

          Process.sleep(:infinity)
        end)
      end
    })

    {:ok, lock_breaker_pid} =
      Electric.Postgres.LockBreakerConnection.start(
        connection_opts: ctx.db_config,
        stack_id: ctx.stack_id
      )

    lock_breaker_monitor = Process.monitor(lock_breaker_pid)

    assert_receive :lock_acquired

    # Verify there's an entry for the acquired lock in pg_locks
    assert %Postgrex.Result{rows: [_pg_backend_pid], num_rows: 1} =
             Postgrex.query!(
               ctx.db_conn,
               "SELECT pid FROM pg_locks WHERE objid::bigint = hashtext($1) AND locktype = 'advisory'",
               [ctx.slot_name]
             )

    # Make sure we can stop the lock connection above, so we're not specifying current pid
    LockBreakerConnection.stop_backends_and_close(lock_breaker_pid, ctx.slot_name)

    assert_receive {:DOWN, ^lock_breaker_monitor, :process, ^lock_breaker_pid, :shutdown}

    # Verify that the pg_locks entry is gone
    assert %Postgrex.Result{rows: [], num_rows: 0} =
             Postgrex.query!(
               ctx.db_conn,
               "SELECT pid FROM pg_locks WHERE objid::bigint = hashtext($1) AND locktype = 'advisory'",
               [ctx.slot_name]
             )
  end

  test "doesn't break the lock if it's taken from expected lock connection", ctx do
    Postgrex.query!(
      ctx.db_conn,
      "SELECT pg_create_logical_replication_slot('#{ctx.slot_name}', 'pgoutput')"
    )

    {:ok, replication_client_pid} =
      start_supervised(
        {ReplicationClient,
         stack_id: ctx.stack_id,
         replication_opts: [
           connection_opts: ctx.db_config,
           stack_id: ctx.stack_id,
           publication_name: ctx.slot_name,
           try_creating_publication?: false,
           slot_name: ctx.slot_name,
           handle_operations: nil,
           connection_manager: self()
         ]}
      )

    replication_client_monitor = Process.monitor(replication_client_pid)

    {:ok, lock_breaker_pid} =
      start_supervised(%{
        id: :lock_breaker,
        start:
          {Electric.Postgres.LockBreakerConnection, :start,
           [[connection_opts: ctx.db_config, stack_id: ctx.stack_id]]}
      })

    lock_breaker_monitor = Process.monitor(lock_breaker_pid)

    assert_receive {:"$gen_cast", {:pg_info_obtained, %{pg_backend_pid: pg_backend_pid}}}
    assert_receive {:"$gen_cast", :replication_client_lock_acquired}

    LockBreakerConnection.stop_backends_and_close(lock_breaker_pid, ctx.slot_name, pg_backend_pid)

    assert_receive {:DOWN, ^lock_breaker_monitor, :process, ^lock_breaker_pid, :shutdown}
    refute_received {:DOWN, ^replication_client_monitor, :process, _pid, _reason}

    stop_supervised(ReplicationClient)
  end
end
