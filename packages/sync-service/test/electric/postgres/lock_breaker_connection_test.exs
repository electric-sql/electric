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

    {:ok, pid} =
      start_supervised(%{
        id: :lock_breaker,
        start:
          {Electric.Postgres.LockBreakerConnection, :start,
           [[connection_opts: ctx.db_config, stack_id: ctx.stack_id]]}
      })

    ref2 = Process.monitor(pid)

    assert_receive :lock_acquired

    # Make sure we can stop the lock connection above, so we're not specifying current pid
    LockBreakerConnection.stop_backends_and_close(pid, ctx.slot_name)

    assert_receive {:DOWN, ^ref2, :process, ^pid, _reason}

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

    {:ok, pid} =
      start_supervised(
        {ReplicationClient,
         stack_id: ctx.stack_id,
         replication_opts: [
           connection_opts: ctx.db_config,
           stack_id: ctx.stack_id,
           publication_name: ctx.slot_name,
           try_creating_publication?: false,
           slot_name: ctx.slot_name,
           transaction_received: nil,
           relation_received: nil,
           connection_manager: self()
         ]}
      )

    ref1 = Process.monitor(pid)

    {:ok, pid} =
      start_supervised(%{
        id: :lock_breaker,
        start:
          {Electric.Postgres.LockBreakerConnection, :start,
           [[connection_opts: ctx.db_config, stack_id: ctx.stack_id]]}
      })

    ref2 = Process.monitor(pid)

    assert_receive {:"$gen_cast", {:pg_info_obtained, %{pg_backend_pid: pg_backend_pid}}}
    assert_receive {:"$gen_cast", :replication_client_lock_acquired}

    LockBreakerConnection.stop_backends_and_close(pid, ctx.slot_name, pg_backend_pid)

    assert_receive {:DOWN, ^ref2, :process, ^pid, _reason}
    refute_received {:DOWN, ^ref1, :process, _, _reason}
    stop_supervised(ReplicationClient)
  end
end
