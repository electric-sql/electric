defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "instance_id/0" do
    assert Electric.instance_id() == "electric"
  end
end
