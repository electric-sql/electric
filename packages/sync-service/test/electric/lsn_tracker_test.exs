defmodule Electric.LsnTrackerTest do
  use ExUnit.Case, async: true

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]
  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn

  setup [:with_stack_id_from_test]

  describe "get_last_processed_lsn/1" do
    setup ctx do
      LsnTracker.initialize(ctx.stack_id)
      :ok
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
end
