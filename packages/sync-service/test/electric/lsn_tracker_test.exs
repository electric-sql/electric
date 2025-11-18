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
      LsnTracker.set_last_processed_lsn(lsn, stack_id)

      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
    end

    test "returns last set lsn", %{stack_id: stack_id} do
      lsn = Lsn.from_integer(7)
      LsnTracker.set_last_processed_lsn(lsn, stack_id)

      lsn = Lsn.from_integer(77)
      LsnTracker.set_last_processed_lsn(lsn, stack_id)

      lsn = Lsn.from_integer(111)
      LsnTracker.set_last_processed_lsn(lsn, stack_id)

      assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
    end
  end
end
