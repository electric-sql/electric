defmodule Electric.Satellite.Permissions.MultipleScopesTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Chgs,
    Perms,
    Roles,
    Tree
  }

  alias Electric.Satellite.{Permissions, Permissions.Scope}
  alias Electric.Replication.Changes

  import ElectricTest.PermissionsHelpers

  @restaurants {"public", "restaurants"}
  @orders {"public", "orders"}
  @dishes {"public", "dishes"}
  @riders {"public", "riders"}
  @customers {"public", "customers"}
  @order_riders {"public", "order_riders"}
  @addresses {"public", "addresses"}

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
          {@restaurants, nil,
           [
             {@dishes, "restaurant_id", []},
             {@orders, "restaurant_id", [{@order_riders, "order_id", []}]}
           ]},
          {@customers, nil,
           [
             {@orders, "customer_id",
              [
                {@dishes, "order_dish_id", []},
                {@order_riders, "order_id", []},
                {@addresses, "address_id"}
              ]},
             {@addresses, "customer_id", []}
           ]},
          {@riders, nil, [{@order_riders, "rider_id"}]}
        ]
      )

    {:ok, _} = start_supervised(Perms.Transient)

    {:ok, tree: tree}
  end

  def assign_rider(tree, order_id, rider_id) do
    v = {@order_riders, {order_id, rider_id}}

    tree
    |> Tree.add_vertex(v)
    |> Tree.add_edge({@orders, order_id}, v)
    |> Tree.add_edge({@riders, rider_id}, v)
    |> Tree.add_edge(v, {@orders, order_id})
    |> Tree.add_edge(v, {@riders, rider_id})
  end

  def unassign_rider(tree, order_id, rider_id) do
    v = {@order_riders, {order_id, rider_id}}

    Tree.delete_vertex(tree, v)
  end

  describe "tree test" do
    test "scope_id/3", cxt do
      assert {"r2", [_ | _]} =
               Scope.scope_id(cxt.tree, @restaurants, %Changes.NewRecord{
                 relation: @orders,
                 record: %{"id" => "c2-r2-o2", "restaurant_id" => "r2", "customer_id" => "c2"}
               })

      assert {"r2", [_ | _]} =
               Scope.scope_id(cxt.tree, @restaurants, @orders, %{
                 "id" => "c2-r2-o2",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })

      assert {"c2", [_ | _]} =
               Scope.scope_id(cxt.tree, @customers, %Changes.NewRecord{
                 relation: @orders,
                 record: %{"id" => "c2-r1-o1", "restaurant_id" => "r2", "customer_id" => "c2"}
               })

      assert {"c2", [_ | _]} =
               Scope.scope_id(cxt.tree, @customers, @orders, %{
                 "id" => "c2-r1-o1",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })
    end

    test "scope_id/3 for riders", cxt do
      refute Scope.scope_id(cxt.tree, @restaurants, @riders, %{
               "id" => "d1"
             })

      tree = assign_rider(cxt.tree, "c2-r1-o1", "d1")

      assert {"r1", [_ | _]} =
               Scope.scope_id(tree, @restaurants, @riders, %{
                 "id" => "d1"
               })

      assert {"c2", [_ | _]} =
               Scope.scope_id(tree, @customers, @riders, %{
                 "id" => "d1"
               })

      assert {"c2-r1-o1", [_ | _]} =
               Scope.scope_id(tree, @orders, @riders, %{
                 "id" => "d1"
               })

      tree = unassign_rider(tree, "c2-r1-o1", "d1")

      refute Scope.scope_id(tree, @restaurants, @riders, %{
               "id" => "d1"
             })

      refute Scope.scope_id(tree, @orders, @riders, %{
               "id" => "d1"
             })
    end
  end

  describe "Permissions.filter_read/2" do
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
    test "correctly determines scope", cxt do
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
