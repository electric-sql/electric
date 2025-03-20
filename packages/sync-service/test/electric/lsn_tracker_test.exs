defmodule Electric.LsnTrackerTest do
  use ExUnit.Case

  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]
  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn

  setup [:with_stack_id_from_test]

  test "get_last_processed_lsn/1", %{stack_id: stack_id} do
    lsn = Lsn.from_integer(7)

    LsnTracker.init(stack_id)
    LsnTracker.set_last_processed_lsn(lsn, stack_id)

    assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
  end

  test "reset/1", %{stack_id: stack_id} do
    lsn = Lsn.from_integer(7)

    LsnTracker.init(stack_id)
    LsnTracker.set_last_processed_lsn(lsn, stack_id)
    LsnTracker.reset(stack_id)

    assert LsnTracker.get_last_processed_lsn(stack_id) == Lsn.from_integer(0)
  end
end
