defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "cluster_name/0" do
    assert Electric.cluster_name() == "electric-development-cluster-0000"
  end
end
