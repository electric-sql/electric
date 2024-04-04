defmodule Electric.Postgres.Schema.FkGraphTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Schema.FkGraph
  alias Electric.Postgres.TestConnection
  alias ElectricTest.PermissionsHelpers.Schema

  @restaurants {"public", "restaurants"}
  @orders {"public", "orders"}
  @riders {"public", "riders"}
  @order_riders {"public", "order_riders"}
  @bikes {"public", "bikes"}
  @wheels {"public", "wheels"}
  @bike_wheels {"public", "bike_wheels"}
  @users {"public", "users"}
  @addresses {"public", "addresses"}

  setup do
    graph =
      FkGraph.new(
        [
          {@orders, @restaurants, ["restaurant_id"]},
          {@order_riders, @orders, ["order_id"]},
          {@order_riders, @riders, ["rider_id"]},
          {@addresses, @users, ["user_id"]},
          # very realistic many-to-many between wheels and bikes...
          {@bikes, @riders, ["rider_id"]},
          {@bike_wheels, @bikes, ["bike_id"]},
          {@bike_wheels, @wheels, ["wheel_id"]}
        ],
        %{}
      )

    {:ok, graph: graph}
  end

  describe "path/3" do
    test "traverses the graph to give a path from one relation to another", cxt do
      assert [@riders, @order_riders, @orders] = FkGraph.path(cxt.graph, @orders, @riders)
      assert [@orders, @order_riders, @riders] = FkGraph.path(cxt.graph, @riders, @orders)

      assert [@riders, @order_riders, @orders, @restaurants] =
               FkGraph.path(cxt.graph, @restaurants, @riders)

      assert [@bikes, @riders, @order_riders, @orders] =
               FkGraph.path(cxt.graph, @orders, @bikes)

      assert [@wheels, @bike_wheels, @bikes, @riders, @order_riders, @orders, @restaurants] =
               FkGraph.path(cxt.graph, @restaurants, @wheels)
    end
  end

  describe "routes/3" do
    defp graph(scenario) do
      migrations = TestConnection.migrations(scenario)

      {:ok, schema_version} = Schema.load(migrations)

      FkGraph.for_schema(schema_version)
    end

    test "linear: comment authors" do
      graph = graph(:linear)

      assert [[{:root, {"public", "projects"}}]] =
               FkGraph.routes(graph, {"public", "projects"}, {"public", "projects"})

      assert [
               [
                 {:one_to_many, {"public", "users"}},
                 {:many_to_one, {"public", "comments"}},
                 {:many_to_one, {"public", "issues"}},
                 {:root, {"public", "projects"}}
               ],
               [
                 {:one_to_many, {"public", "users"}},
                 {:many_to_one, {"public", "project_memberships"}},
                 {:root, {"public", "projects"}}
               ],
               # because this schema has an fk from project_memberships to team_memberships, we end up
               # with this route too...
               [
                 {:one_to_many, {"public", "users"}},
                 {:one_to_many, {"public", "team_memberships"}},
                 {:many_to_one, {"public", "project_memberships"}},
                 {:root, {"public", "projects"}}
               ]
             ] = FkGraph.routes(graph, {"public", "projects"}, {"public", "users"})
    end

    test "entries" do
      graph = graph(:entries_and_documents)

      assert [
               [
                 {:many_to_one, {"public", "authored_entries"}},
                 {:root, {"public", "users"}}
               ],
               [
                 {:one_to_many, {"public", "authored_entries"}},
                 {:many_to_one, {"public", "comments"}},
                 {:root, {"public", "users"}}
               ]
             ] = FkGraph.routes(graph, {"public", "users"}, {"public", "authored_entries"})

      assert [
               [
                 {:many_to_one, {"public", "comments"}},
                 {:many_to_one, {"public", "authored_entries"}},
                 {:root, {"public", "users"}}
               ],
               [{:many_to_one, {"public", "comments"}}, {:root, {"public", "users"}}]
             ] = FkGraph.routes(graph, {"public", "users"}, {"public", "comments"})
    end
  end

  describe "foreign_key/3" do
    test "returns the foreign key(s) for the table", cxt do
      assert [{@restaurants, ["restaurant_id"]}] =
               FkGraph.foreign_keys(cxt.graph, @restaurants, @orders)

      assert [{@riders, ["rider_id"]}] = FkGraph.foreign_keys(cxt.graph, @orders, @bikes)
      assert [{@riders, ["rider_id"]}] = FkGraph.foreign_keys(cxt.graph, @orders, @bikes)

      # because the `wheel_id` fk on  `bike_wheels` affects the scope of the `wheels table` which
      # is in the `orders` scope, we need to know about it
      assert [{@bikes, ["bike_id"]}, {@wheels, ["wheel_id"]}] =
               FkGraph.foreign_keys(cxt.graph, @orders, @bike_wheels)
    end

    test "returns nil if no fk is found on the table", cxt do
      assert [] = FkGraph.foreign_keys(cxt.graph, @orders, @users)
      # @wheels does not have a fk, because of the many-to-many
      assert [] = FkGraph.foreign_keys(cxt.graph, @orders, @wheels)
    end
  end
end
