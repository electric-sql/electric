defmodule Electric.LsnTrackerTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup, only: [with_registry: 1, with_stack_id_from_test: 1]
  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn

  setup [:with_stack_id_from_test]

  describe "get_last_processed_lsn/1" do
    setup ctx do
      LsnTracker.initialize(ctx.stack_id)
      :ok
    end

    test "returns nil when not yet populated", %{stack_id: stack_id} do
      assert LsnTracker.get_last_processed_lsn(stack_id) == nil
    end

    test "returns inital lsn", %{stack_id: stack_id} do
      lsn = Lsn.from_integer(7)
      LsnTracker.set_last_processed_lsn(stack_id, lsn)

      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
    end

    test "returns last set lsn", %{stack_id: stack_id} do
      lsn = Lsn.from_integer(7)
      LsnTracker.set_last_processed_lsn(stack_id, lsn)

      lsn = Lsn.from_integer(77)
      LsnTracker.set_last_processed_lsn(stack_id, lsn)

      lsn = Lsn.from_integer(111)
      LsnTracker.set_last_processed_lsn(stack_id, lsn)

      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
    end
  end

  describe "initialize_last_processed_lsn/2" do
    setup ctx do
      LsnTracker.initialize(ctx.stack_id)
      :ok
    end

    test "sets lsn when not previously set", %{stack_id: stack_id} do
      lsn = Lsn.from_integer(42)
      assert :ok = LsnTracker.initialize_last_processed_lsn(stack_id, lsn)
      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
    end

    test "accepts integer and converts to Lsn", %{stack_id: stack_id} do
      assert :ok = LsnTracker.initialize_last_processed_lsn(stack_id, 100)
      assert LsnTracker.get_last_processed_lsn(stack_id) == Lsn.from_integer(100)
    end

    test "does not overwrite existing lsn", %{stack_id: stack_id} do
      initial_lsn = Lsn.from_integer(50)
      LsnTracker.set_last_processed_lsn(stack_id, initial_lsn)

      new_lsn = Lsn.from_integer(100)
      assert :ok = LsnTracker.initialize_last_processed_lsn(stack_id, new_lsn)

      # Should still be the initial LSN, not the new one
      assert LsnTracker.get_last_processed_lsn(stack_id) == initial_lsn
    end

    test "is idempotent - can be called multiple times", %{stack_id: stack_id} do
      lsn1 = Lsn.from_integer(10)
      lsn2 = Lsn.from_integer(20)

      assert :ok = LsnTracker.initialize_last_processed_lsn(stack_id, lsn1)
      assert :ok = LsnTracker.initialize_last_processed_lsn(stack_id, lsn2)

      # First call wins
      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn1
    end
  end

  describe "broadcast_last_seen_lsn/2" do
    setup [:with_registry]

    test "delivers messages to processes registered for global_lsn_updates", ctx do
      LsnTracker.subscribe_to_global_lsn_updates(ctx.stack_id)

      :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 42)

      assert_receive {:global_last_seen_lsn, 42}
    end

    test "delivers to multiple registered processes", ctx do
      test_pid = self()
      LsnTracker.subscribe_to_global_lsn_updates(ctx.stack_id)

      {other_pid, ref} =
        spawn_monitor(fn ->
          LsnTracker.subscribe_to_global_lsn_updates(ctx.stack_id)
          send(test_pid, :registered)

          receive do
            {:global_last_seen_lsn, lsn} -> send(test_pid, {:got_lsn, lsn})
          end
        end)

      assert_receive :registered

      :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 99)

      assert_receive {:global_last_seen_lsn, 99}
      assert_receive {:got_lsn, 99}
      assert_receive {:DOWN, ^ref, :process, ^other_pid, :normal}
    end

    test "is a no-op when no processes are registered", ctx do
      assert :ok = LsnTracker.broadcast_last_seen_lsn(ctx.stack_id, 42)
      refute_receive {:global_last_seen_lsn, _}
    end
  end
end
