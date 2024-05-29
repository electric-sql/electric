defmodule Electric.Satellite.Permissions.JoinTableTest do
  use ExUnit.Case, async: true

  alias ElectricTest.PermissionsHelpers.{
    Chgs,
    Perms,
    Roles,
    Schema,
    Server,
    Tree
  }

  alias Electric.Postgres.Extension.SchemaLoader
  alias Electric.Postgres.MockSchemaLoader
  alias Electric.Satellite.Permissions
  alias Electric.Satellite.Permissions.Graph

  import ElectricTest.PermissionsHelpers

  @addresses {"public", "addresses"}
  @customers {"public", "customers"}
  @dishes {"public", "dishes"}
  @order_riders {"public", "order_riders"}
  @orders {"public", "orders"}
  @restaurants {"public", "restaurants"}
  @riders {"public", "riders"}

  def assign_rider(tree, structure, order_id, rider_id) do
    Server.apply_change(
      tree,
      structure,
      Chgs.insert(@order_riders, %{
        "id" => {order_id, rider_id},
        "order_id" => order_id,
        "rider_id" => rider_id
      })
    )
  end

  def unassign_rider(tree, structure, order_id, rider_id) do
    Server.apply_change(
      tree,
      structure,
      Chgs.delete(@order_riders, %{
        "id" => {order_id, rider_id},
        "order_id" => order_id,
        "rider_id" => rider_id
      })
    )
  end

  def add_order(tree, structure, restaurant_id, order_id) do
    Server.apply_change(
      tree,
      structure,
      Chgs.insert(@orders, %{"id" => order_id, "restaurant_id" => restaurant_id})
    )
  end

  describe "simple join table" do
    setup do
      migrations = [
        {"01",
         [
           "create table restaurants (id uuid primary key)",
           "create table orders (id uuid primary key, restaurant_id uuid not null references restaurants (id))",
           "create table riders (id uuid primary key)",
           """
           create table order_riders (
              id uuid primary key,
              order_id uuid not null references orders (id),
              rider_id uuid not null references riders (id)
           )
           """
         ]}
      ]

      data = [
        {@restaurants, "rt1", []},
        {@orders, "or1", []},
        {@orders, "or2", []},
        {@riders, "rd1", []},
        {@riders, "rd2", []}
      ]

      {:ok, loader} = Schema.loader(migrations)
      {:ok, schema_version} = SchemaLoader.load(loader)

      tree = Tree.new(data, schema_version)

      perms =
        perms_build(
          schema_version,
          [
            ~s[GRANT ALL ON riders TO (riders, 'self')],
            ~s[GRANT READ ON orders TO (orders, 'rider')],
            ~s[GRANT READ ON restaurants TO (orders, 'rider')],
            ~s[ASSIGN (orders, 'rider') TO order_riders.rider_id],
            ~s[ASSIGN (riders, 'self') TO riders.id]
          ],
          []
        )

      tree = add_order(tree, perms.structure, "rt1", "or1")

      {:ok,
       tree: tree,
       data: data,
       loader: loader,
       schema_version: schema_version,
       perms: perms,
       structure: perms.structure}
    end

    test "scope_id resolves across join tables", cxt do
      assert [] = Graph.scope_id(cxt.tree, cxt.structure, @orders, @riders, ["rd1"])

      tree = assign_rider(cxt.tree, cxt.structure, "or1", "rd1")

      assert [{["or1"], _}] = Graph.scope_id(tree, cxt.structure, @orders, @riders, ["rd1"])

      assert [{["rt1"], _}] =
               Graph.scope_id(tree, cxt.structure, @restaurants, @riders, ["rd1"])

      assert [] = Graph.scope_id(tree, cxt.structure, @orders, @riders, ["rd2"])
    end

    test "scope_path resolves across join tables", cxt do
      assert [] = Graph.scope_path(cxt.tree, cxt.structure, @orders, @riders, ["rd1"])

      tree = assign_rider(cxt.tree, cxt.structure, "or1", "rd1")

      assert [
               [
                 {@orders, ["or1"], _},
                 {@order_riders, [{"or1", "rd1"}], _},
                 {@riders, ["rd1"], _}
               ]
             ] = Graph.scope_path(tree, cxt.structure, @orders, @riders, ["rd1"])

      assert [
               [
                 {@restaurants, ["rt1"], _},
                 {@orders, ["or1"], []},
                 {@order_riders, [{"or1", "rd1"}], []},
                 {@riders, ["rd1"], []}
               ]
             ] = Graph.scope_path(tree, cxt.structure, @restaurants, @riders, ["rd1"])

      assert [] = Graph.scope_path(tree, cxt.structure, @orders, @riders, ["rd2"])
    end
  end

  describe "more complex schema" do
    setup do
      loader_spec =
        MockSchemaLoader.backend_spec(
          migrations: [
            {"01",
             [
               "create table restaurants (id uuid primary key)",
               "create table customers (id uuid primary key)",
               "create table riders (id uuid primary key)",
               "create table addresses (id uuid primary key, customer_id uuid references customers (id))",
               """
               create table orders (
                  id uuid primary key,
                  restaurant_id uuid not null references restaurants (id),
                  customer_id uuid not null references customers (id),
                  address_id uuid not null references addresses (id)
                )
               """,
               """
               create table dishes (
                  id uuid primary key,
                  restaurant_id uuid not null references restaurants (id)
               )
               """,
               """
               create table order_riders (
                  id uuid primary key,
                  order_id uuid not null references orders (id),
                  rider_id uuid not null references riders (id)
               )
               """,
               """
               create table order_dishes (
                  id uuid primary key,
                  order_id uuid not null references orders (id),
                  dish_id uuid not null references dishes (id)
               )
               """
             ]}
          ]
        )

      {:ok, loader} = SchemaLoader.connect(loader_spec, [])
      {:ok, schema_version} = SchemaLoader.load(loader)

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
          schema_version
        )

      perms =
        perms_build(
          schema_version,
          [
            ~s[GRANT ALL ON riders TO (riders, 'self')],
            ~s[GRANT READ ON orders TO (orders, 'rider')],
            ~s[GRANT READ ON restaurants TO (orders, 'rider')],
            ~s[ASSIGN (orders, 'rider') TO order_riders.rider_id],
            ~s[ASSIGN (riders, 'self') TO riders.id]
          ],
          []
        )

      {:ok, _} = start_supervised(Perms.Transient)

      {:ok,
       tree: tree,
       loader: loader,
       schema_version: schema_version,
       perms: perms,
       structure: perms.structure}
    end

    test "scope_id/3", cxt do
      assert [{["r2"], [_ | _]}] =
               Graph.scope_id(
                 cxt.tree,
                 cxt.structure,
                 @restaurants,
                 Chgs.insert(@orders, %{
                   "id" => "c2-r2-o2",
                   "restaurant_id" => "r2",
                   "customer_id" => "c2"
                 })
               )

      assert [{["r2"], [_ | _]}] =
               Graph.scope_id(cxt.tree, cxt.structure, @restaurants, @orders, %{
                 "id" => "c2-r2-o2",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(
                 cxt.tree,
                 cxt.structure,
                 @customers,
                 Chgs.insert(@orders, %{
                   "id" => "c2-r1-o1",
                   "restaurant_id" => "r2",
                   "customer_id" => "c2"
                 })
               )

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(cxt.tree, cxt.structure, @customers, @orders, %{
                 "id" => "c2-r1-o1",
                 "restaurant_id" => "r2",
                 "customer_id" => "c2"
               })
    end

    test "scope_id/3 for riders", cxt do
      assert [] = Graph.scope_id(cxt.tree, cxt.structure, @orders, @riders, %{"id" => "d1"})

      tree = assign_rider(cxt.tree, cxt.structure, "c2-r1-o1", "d1")

      assert [{["c2-r1-o1"], [_ | _]}] =
               Graph.scope_id(tree, cxt.structure, @orders, @riders, %{
                 "id" => "d1"
               })

      assert [{["c2"], [_ | _]}] =
               Graph.scope_id(tree, cxt.structure, @customers, @riders, %{
                 "id" => "d1"
               })

      assert [{["c2-r1-o1"], [_ | _]}] =
               Graph.scope_id(tree, cxt.structure, @orders, @riders, %{
                 "id" => "d1"
               })

      tree = unassign_rider(tree, cxt.structure, "c2-r1-o1", "d1")

      assert [] =
               Graph.scope_id(tree, cxt.structure, @restaurants, @riders, %{
                 "id" => "d1"
               })

      assert [] =
               Graph.scope_id(tree, cxt.structure, @orders, @riders, %{
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
      tree = assign_rider(cxt.tree, cxt.structure, "c2-r2-o2", "d1")

      perms =
        perms_build(
          cxt,
          [
            ~s[GRANT READ ON #{table(@orders)} TO (#{table(@orders)}, 'rider')],
            ~s[GRANT READ ON #{table(@addresses)} TO (#{table(@orders)}, 'rider')],
            ~s[ASSIGN (#{table(@orders)}, 'rider') TO #{table(@order_riders)}.user_id]
          ],
          [
            Roles.role("rider", @orders, "c2-r2-o2", "assign-1")
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

      {filtered_tx, [_], []} = Permissions.filter_read(perms, tree, Chgs.tx(changes))

      assert filtered_tx.changes == [
               Chgs.update(@addresses, %{"id" => "c2-a2", "customer_id" => "c2"}, %{
                 "address" => "changed"
               })
             ]
    end
  end
end
