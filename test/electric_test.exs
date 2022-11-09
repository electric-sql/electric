defmodule ElectricTest do
  use ExUnit.Case, async: true

  test "global_cluster_id/0" do
    assert Electric.global_cluster_id() == "electric-development-cluster-0000"
  end
end
