defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "regional_id/0" do
    assert Electric.regional_id() == "region-1.test.electric-db"
  end

  test "instance_id/0" do
    assert Electric.instance_id() == "instance-1.region-1.test.electric-db"
  end
end
