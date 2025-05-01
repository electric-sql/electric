defmodule Electric.Postgres.LockConnectionTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Support.DbSetup, except: [with_publication: 1]
  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  alias Electric.Postgres.LockConnection

  @lock_name "test_electric_slot"

  describe "LockConnection init" do
    setup [:with_unique_db, :with_stack_id_from_test]

    test "should acquire an advisory lock on startup", %{
      db_config: config,
      db_conn: conn,
      stack_id: stack_id
    } do
      log =
        capture_log(fn ->
          assert {:ok, _pid} =
                   LockConnection.start_link(
                     connection_opts: config,
                     connection_manager: self(),
                     lock_name: @lock_name,
                     stack_id: stack_id
                   )

          assert_lock_acquired()
        end)

      # should have logged lock acquisition process
      assert log =~ "Acquiring lock from postgres with name #{@lock_name}"
      assert log =~ "Lock acquired from postgres with name #{@lock_name}"

      # should have acquired an advisory lock on PG
      assert %Postgrex.Result{rows: [[false]]} =
               Postgrex.query!(
                 conn,
                 "SELECT pg_try_advisory_lock(hashtext('#{@lock_name}'))",
                 []
               )
    end

    test "should wait if lock is already acquired", %{db_config: config, stack_id: stack_id} do
      # grab lock with one connection
      assert {:ok, pid1} =
               LockConnection.start_link(
                 connection_opts: config,
                 connection_manager: self(),
                 lock_name: @lock_name,
                 stack_id: stack_id
               )

      assert_lock_acquired()

      # try to grab the same with another
      new_stack_id = :"#{stack_id}_new"

      assert {:ok, _pid} =
               LockConnection.start_link(
                 connection_opts: config,
                 connection_manager: self(),
                 lock_name: @lock_name,
                 stack_id: new_stack_id
               )

      # should fail to grab it
      refute_lock_acquired()

      # should immediately grab it once previous lock is released
      GenServer.stop(pid1)
      assert_lock_acquired()
    end
  end

  defp assert_lock_acquired do
    assert_receive {:"$gen_cast", :exclusive_connection_lock_acquired}
  end

  defp refute_lock_acquired do
    refute_receive {:"$gen_cast", :exclusive_connection_lock_acquired}, 1000
  end
end
