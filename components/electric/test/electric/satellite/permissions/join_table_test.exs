defmodule Electric.Satellite.Permissions.JoinTableTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Chgs,
    Perms,
    Roles,
    Tree
  }

  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Graph

  import ElectricTest.PermissionsHelpers

  @addresses {"public", "addresses"}
  @customers {"public", "customers"}
  @dishes {"public", "dishes"}
  @order_dishes {"public", "order_dishes"}
  @order_riders {"public", "order_riders"}
  @orders {"public", "orders"}
  @restaurants {"public", "restaurants"}
  @riders {"public", "riders"}

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

  describe "simple join table" do
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
      assert [] = Graph.scope_id(cxt.tree, @orders, @riders, ["rd1"])

      tree = assign_rider(cxt.tree, "or1", "rd1")

      assert [{["or1"], _}] = Graph.scope_id(tree, @orders, @riders, ["rd1"])
      assert [{["rt1"], _}] = Graph.scope_id(tree, @restaurants, @riders, ["rd1"])
      assert [] = Graph.scope_id(tree, @orders, @riders, ["rd2"])
    end

    test "scope_path resolves across join tables", cxt do
      assert [] = Graph.scope_path(cxt.tree, @orders, @riders, ["rd1"])

      tree = assign_rider(cxt.tree, "or1", "rd1")

      assert [[{@orders, ["or1"], _}, {@order_riders, ["or1", "rd1"], _}, {@riders, ["rd1"], _}]] =
               Graph.scope_path(tree, @orders, @riders, ["rd1"])

      assert [
               [
                 {@restaurants, ["rt1"], _},
                 {@orders, ["or1"], []},
                 {@order_riders, ["or1", "rd1"], []},
                 {@riders, ["rd1"], []}
               ]
             ] = Graph.scope_path(tree, @restaurants, @riders, ["rd1"])

      assert [] = Graph.scope_path(tree, @orders, @riders, ["rd2"])
    end
  end

  describe "more complex schema" do
    setup do
      tree =
        Tree.new(
          [
            {@restaurants, "r1",
             [
               {@dishes, "r1-d1", []},
               {@dishes, "r1-d2", []},
               {@dishes, "r1-d3", []},
               {@orders, "c1-r1-o1", []},
               {@orders, "c1-r1-o2", []},
               {@orders, "c2-r1-o1", []}
             ]},
            {@restaurants, "r2",
             [
               {@dishes, "r2-d1", []},
               {@dishes, "r2-d2", []},
               {@dishes, "r2-d3", []},
               {@orders, "c2-r2-o2", []}
             ]},
            {@customers, "c1",
             [
               {@orders, "c1-r1-o1",
                [
                  {@addresses, "c1-a1"}
                ]},
               {@orders, "c1-r1-o2",
                [
                  {@addresses, "c1-a2"}
                ]},
               {@addresses, "c1-a1"},
               {@addresses, "c1-a2"}
             ]},
            {@customers, "c2",
             [
               {@orders, "c2-r1-o1",
                [
                  {@addresses, "c2-a1"}
                ]},
               {@orders, "c2-r2-o2",
                [
                  {@addresses, "c2-a2"}
                ]},
               {@addresses, "c2-a1", []},
               {@addresses, "c2-a2", []}
             ]},
            {@customers, "c3", []},
            {@riders, "d1", []},
            {@riders, "d2", []},
            {@riders, "d3", []}
          ],
          [
            {@addresses, @customers, ["customer_id"]},
            {@dishes, @restaurants, ["restaurant_id"]},
            {@order_dishes, @dishes, ["dish_id"]},
            {@order_dishes, @orders, ["order_id"]},
            {@order_riders, @orders, ["order_id"]},
            {@order_riders, @riders, ["rider_id"]},
            {@orders, @addresses, ["address_id"]},
            {@orders, @customers, ["customer_id"]},
            {@orders, @restaurants, ["restaurant_id"]}
          ]
        )

      {:ok, _} = start_supervised(Perms.Transient)

      {:ok, tree: tree}
    end

    test "scope_id/3", cxt do
      assert [{["r2"], [_ | _]}] =
               Graph.scope_id(
                 cxt.tree,
                 @restaurants,
                 Chgs.insert(@orders, %{
                   "id" => "c2-r2-o2",
                   "restaurant_id" => "r2",
                   "customer_id" => "c2"
                 })
               )

      assert [{["r2"], [_ | _]}] =
               Graph.scope_id(cxt.tree, @restaurants, @orders, %{
                 "id" => "c2-r2-o2",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(
                 cxt.tree,
                 @customers,
                 Chgs.insert(@orders, %{
                   "id" => "c2-r1-o1",
                   "restaurant_id" => "r2",
                   "customer_id" => "c2"
                 })
               )

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(cxt.tree, @customers, @orders, %{
                 "id" => "c2-r1-o1",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })
    end

    test "scope_id/3 for riders", cxt do
      assert [] =
               Graph.scope_id(cxt.tree, @orders, @riders, %{
                 "id" => "d1"
               })

      tree = assign_rider(cxt.tree, "c2-r1-o1", "d1")

      assert [{["c2-r1-o1"], [_ | _]}] =
               Graph.scope_id(tree, @orders, @riders, %{
                 "id" => "d1"
               })

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(tree, @customers, @riders, %{
                 "id" => "d1"
               })

      assert [{["c2-r1-o1"], [_ | _]}] =
               Graph.scope_id(tree, @orders, @riders, %{
                 "id" => "d1"
               })

      tree = unassign_rider(tree, "c2-r1-o1", "d1")

      assert [] =
               Graph.scope_id(tree, @restaurants, @riders, %{
                 "id" => "d1"
               })

      assert [] =
               Graph.scope_id(tree, @orders, @riders, %{
                 "id" => "d1"
               })
    end

    # this test has to be carefully crafted to work around the limitations of my simplistic tree
    # structure and my simplistic scope path algo.
    #
    # in reality this test isn't really excercising anything that isn't touched in the main
    # permissions test. crucially the ability of the rider in this to read the address is
    # determined by the existence of their role on the correct orders scope.  them not being
    # "assigned" to the order does not affect their perms, it is the presence of this role
    # exclusively (since the address in question is always in the given scope, no matter what the
    # status of the rider).
    #
    # so the functioning (or not) of this test would depend, in the real world, on the correct
    # behaviour of the assigns triggers creating and removing the rider's role.
    #
    # with all that said, I'm leaving this here because we might need to model the more complex
    # data structure it includes.
    test "filter_read/3", cxt do
      tree = assign_rider(cxt.tree, "c2-r2-o2", "d1")

      perms =
        perms_build(
          tree,
          [
            ~s[GRANT READ ON #{table(@orders)} TO (#{table(@orders)}, 'rider')],
            ~s[GRANT READ ON #{table(@addresses)} TO (#{table(@orders)}, 'rider')]
          ],
          [
            Roles.role("rider", @orders, "c2-r2-o2")
          ]
        )

      changes = [
        Chgs.update(@addresses, %{"id" => "c2-a2", "customer_id" => "c2"}, %{
          "address" => "changed"
        }),
        Chgs.update(@addresses, %{"id" => "c2-a1", "customer_id" => "c2"}, %{
          "address" => "changed"
        })
      ]

      {filtered_tx, []} = Permissions.filter_read(perms, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@addresses, %{"id" => "c2-a2", "customer_id" => "c2"}, %{
                 "address" => "changed"
               })
             ]
    end
  end
end
