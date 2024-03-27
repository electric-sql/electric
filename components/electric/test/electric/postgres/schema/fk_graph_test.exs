defmodule Electric.Postgres.Schema.FkGraphTest do
  use ExUnit.Case, async: true

  alias Electric.Postgres.Schema.FkGraph

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
      FkGraph.new([
        {@orders, @restaurants, ["restaurant_id"]},
        {@order_riders, @orders, ["order_id"]},
        {@order_riders, @riders, ["rider_id"]},
        {@addresses, @users, ["user_id"]},
        # very realistic many-to-many between wheels and bikes...
        {@bikes, @riders, ["rider_id"]},
        {@bike_wheels, @bikes, ["bike_id"]},
        {@bike_wheels, @wheels, ["wheel_id"]}
      ])

    {:ok, graph: graph}
  end

  describe "path/3" do
    test "traverses the graph to give a path from one relation to another", cxt do
      assert [@riders, @order_riders, @orders] = FkGraph.path(cxt.graph, @orders, @riders)
      assert [@orders, @order_riders, @riders] = FkGraph.path(cxt.graph, @riders, @orders)

      assert [@riders, @order_riders, @orders, @restaurants] =
               FkGraph.path(cxt.graph, @restaurants, @riders)

      assert [@bikes, @riders, @order_riders, @orders] = FkGraph.path(cxt.graph, @orders, @bikes)

      assert [@wheels, @bike_wheels, @bikes, @riders, @order_riders, @orders, @restaurants] =
               FkGraph.path(cxt.graph, @restaurants, @wheels)
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
