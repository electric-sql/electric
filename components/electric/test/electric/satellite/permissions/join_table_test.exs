defmodule Electric.Satellite.Permissions.JoinTableTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Tree
  }

  alias Electric.Satellite.Permissions.Scope

  @restaurants {"public", "restaurants"}
  @orders {"public", "orders"}
  @riders {"public", "riders"}
  @order_riders {"public", "order_riders"}

  def assign_rider(tree, order_id, rider_id) do
    v = {@order_riders, [order_id, rider_id]}

    tree
    |> Tree.add_vertex(v)
    |> Tree.add_edge(v, {@orders, [order_id]})
    |> Tree.add_edge(v, {@riders, [rider_id]})
  end

  def unassign_rider(tree, order_id, rider_id) do
    v = {@order_riders, [order_id, rider_id]}

    Tree.delete_vertex(tree, v)
  end

  def add_order(tree, restaurant_id, order_id) do
    Tree.add_edge(tree, {@orders, [order_id]}, {@restaurants, [restaurant_id]})
  end

  setup do
    tree =
      Tree.new(
        [
          {@restaurants, "rt1", []},
          {@orders, "or1", []},
          {@orders, "or2", []},
          {@riders, "rd1", []},
          {@riders, "rd2", []}
        ],
        [
          {@orders, @restaurants, ["restaurant_id"]},
          {@order_riders, @orders, ["order_id"]},
          {@order_riders, @riders, ["rider_id"]}
        ]
      )

    tree = add_order(tree, "rt1", "or1")
    {:ok, tree: tree}
  end

  test "scope_id resolves across join tables", cxt do
    refute Scope.scope_id(cxt.tree, @orders, @riders, ["rd1"])

    tree = assign_rider(cxt.tree, "or1", "rd1")

    assert {["or1"], _} = Scope.scope_id(tree, @orders, @riders, ["rd1"])
    assert {["rt1"], _} = Scope.scope_id(tree, @restaurants, @riders, ["rd1"])
    refute Scope.scope_id(tree, @orders, @riders, ["rd2"])
  end
end
