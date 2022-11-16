defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "regional_id/0" do
    assert Electric.regional_id() == "local.dev.electric-db"
  end

  test "instance_id/0" do
    assert Electric.instance_id() == "dev.electric-db"
  end
end
