defmodule Electric.Postgres.LockConnectionTest do
  use ExUnit.Case, async: true
  import ExUnit.CaptureLog
  import Support.DbSetup, except: [with_publication: 1]

  alias Electric.Postgres.LockConnection

  @moduletag :capture_log
  @moduletag :skip
  @lock_name "test_electric_slot"

  describe "LockConnection init" do
    setup [:with_unique_db]

    test "should acquire an advisory lock on startup", %{db_config: config, db_conn: conn} do
      log =
        capture_log(fn ->
          assert {:ok, _pid} =
                   LockConnection.start_link(
                     connection_opts: config,
                     connection_manager: self(),
                     lock_name: @lock_name
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

    test "should wait if lock is already acquired", %{db_config: config} do
      # grab lock with one connection
      {pid1, _} =
        with_log(fn ->
          assert {:ok, pid} =
                   LockConnection.start_link(
                     connection_opts: config,
                     connection_manager: self(),
                     lock_name: @lock_name
                   )

          assert_lock_acquired()
          pid
        end)

      # try to grab the same with another
      _ =
        capture_log(fn ->
          assert {:ok, pid} =
                   LockConnection.start_link(
                     connection_opts: config,
                     connection_manager: self(),
                     lock_name: @lock_name
                   )

          # should fail to grab it
          refute_lock_acquired()

          # should immediately grab it once previous lock is released
          GenServer.stop(pid1)
          assert_lock_acquired()
          pid
        end)
    end
  end

  defp assert_lock_acquired do
    assert_receive {_, :exclusive_connection_lock_acquired}
  end

  defp refute_lock_acquired do
    refute_receive {_, :exclusive_connection_lock_acquired}, 1000
  end
end
