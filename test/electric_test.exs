defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "database_id/0" do
    assert Electric.database_id() == "electric-development-cluster-0000"
  end
end
