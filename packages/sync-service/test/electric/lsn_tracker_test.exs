defmodule Electric.LsnTrackerTest do
  use ExUnit.Case
  alias Electric.LsnTracker
  alias Electric.Postgres.Lsn

  test "set_last_processed_lsn/2" do
    stack_id = "stack_id"
    lsn = Lsn.from_integer(7)

    LsnTracker.init(stack_id)
    LsnTracker.set_last_processed_lsn(lsn, stack_id)

    assert LsnTracker.get_last_processed_lsn(stack_id) == lsn
  end
end
