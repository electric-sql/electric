defmodule Electric.Replication.ShapesTest do
  use ExUnit.Case, async: true

  use Electric.Satellite.Protobuf
  import ElectricTest.SetupHelpers

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Gone
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Replication.Shapes.ShapeRequest.Layer

  describe "process_transaction/2" do
    # @describetag skip: true
    @rel {"public", "entries"}

    setup _ do
      layer = %Layer{
        target_table: {"public", "entries"},
        target_pk: ["id"],
        key: "l1",
        direction: :first_layer
      }

      l1 = %Layer{
        layer
        | where_target:
            Eval.Parser.parse_and_validate_expression!("this.value > 10", %{
              ["this", "value"] => :int4
            })
      }

      shape = %ShapeRequest{
        tree: l1,
        layer_map: %{{"public", "entries"} => [l1]}
      }

      l2 = %Layer{
        layer
        | key: "l2",
          where_target:
            Eval.Parser.parse_and_validate_expression!("this.other > 10", %{
              ["this", "other"] => :int4
            })
      }

      second_shape = %ShapeRequest{
        tree: l2,
        layer_map: %{{"public", "entries"} => [l2]}
      }

      [shape: shape, second_shape: second_shape]
    end

    test "removes all changes when no requests are provided" do
      assert {%{changes: []}, _, _} =
               Shapes.process_transaction(tx([insert(%{})]), Graph.new(), [])
    end

    test "never removes DDL changes" do
      assert {%{changes: [_]}, _, _} =
               insert(Electric.Postgres.Extension.ddl_relation(), %{})
               |> List.wrap()
               |> tx()
               |> Shapes.process_transaction(Graph.new(), [])
    end

    test "keeps around relations that satisfy shapes", ctx do
      assert {%{changes: [%{relation: {"public", "entries"}}]}, graph, _} =
               tx([
                 insert({"public", "entries"}, %{"id" => "1", "value" => "11"}),
                 insert({"public", "other"}, %{"id" => "1", "value" => "11"})
               ])
               |> Shapes.process_transaction(Graph.new(), [ctx.shape])

      assert Graph.edge(graph, :root, {{"public", "entries"}, ["1"]}, "l1")
    end

    test "filters non-move updates based on where clause", ctx do
      graph = Graph.new() |> Graph.add_edge(:root, {@rel, ["test"]}, label: "l1")

      update_to_keep = update(%{"id" => "test"}, %{"value" => "11"}, %{"value" => "12"})

      tx =
        tx([
          update(%{"id" => "other"}, %{"value" => "1"}, %{"value" => "2"}),
          update_to_keep
        ])

      assert {%{changes: [^update_to_keep]}, ^graph, _} =
               Shapes.process_transaction(tx, graph, [ctx.shape])
    end

    test "converts move updates based on where clause", ctx do
      graph = Graph.new() |> Graph.add_edge(:root, {@rel, ["test2"]}, label: "l1")

      tx =
        tx([
          update(%{"id" => "test1"}, %{"value" => "1"}, %{"value" => "11"}),
          update(%{"id" => "test2"}, %{"value" => "12"}, %{"value" => "2"})
        ])

      assert {%{
                changes: [
                  %NewRecord{record: %{"value" => "11"}},
                  %Gone{pk: ["test2"]}
                ]
              }, graph, _} = Shapes.process_transaction(tx, graph, [ctx.shape])

      assert Graph.edge(graph, :root, {@rel, ["test1"]}, "l1")
      refute Graph.edge(graph, :root, {@rel, ["test2"]}, "l1")
    end

    test "keeps update as-is if it's still in at least one shape despite a move-out", ctx do
      graph =
        Graph.new()
        |> Graph.add_edge(:root, {@rel, ["test"]}, label: "l1")
        |> Graph.add_edge(:root, {@rel, ["test"]}, label: "l2")

      update =
        update(
          %{"id" => "test"},
          %{"value" => "12", "other" => "12"},
          %{"value" => "12", "other" => "1"}
        )

      tx = tx([update])

      assert {%{changes: [^update]}, graph, _} =
               Shapes.process_transaction(tx, graph, [ctx.shape, ctx.second_shape])

      assert Graph.edge(graph, :root, {@rel, ["test"]}, "l1")
      refute Graph.edge(graph, :root, {@rel, ["test"]}, "l2")
    end

    test "keeps update as-is if it's a move-in and move-out for different shapes", ctx do
      graph =
        Graph.new()
        |> Graph.add_edge(:root, {@rel, ["test"]}, label: "l2")

      update =
        update(%{"id" => "test"}, %{"value" => "1", "other" => "12"}, %{
          "value" => "12",
          "other" => "1"
        })

      tx = tx([update])

      assert {%{changes: [^update]}, graph, _} =
               Shapes.process_transaction(tx, graph, [ctx.shape, ctx.second_shape])

      assert Graph.edge(graph, :root, {@rel, ["test"]}, "l1")
      refute Graph.edge(graph, :root, {@rel, ["test"]}, "l2")
    end
  end

  describe "validate_requests/2" do
    setup do
      start_schema_cache([
        {
          "2023071300",
          [
            "CREATE TABLE public.entries (id uuid PRIMARY KEY);",
            "CREATE TABLE public.parent (id uuid PRIMARY KEY, value TEXT);",
            "CREATE TABLE public.child (id uuid PRIMARY KEY, parent_id uuid REFERENCES public.parent(id));"
          ]
        }
      ])
    end

    test "validates correct Protobuf requests", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [%SatShapeDef.Select{tablename: "entries"}]
        }
      }

      assert {:ok, [%Shapes.ShapeRequest{}]} = Shapes.validate_requests([request], origin)
    end

    test "fails if tables don't exist", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [%SatShapeDef.Select{tablename: "who knows"}]
        }
      }

      assert {:error, [{"id1", :TABLE_NOT_FOUND, "Unknown table who knows"}]} =
               Shapes.validate_requests([request], origin)
    end

    test "doesn't reflect back table names that are too long", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [%SatShapeDef.Select{tablename: for(_ <- 1..100, into: "", do: "a")}]
        }
      }

      assert {:error, [{"id1", :TABLE_NOT_FOUND, "Invalid table name"}]} =
               Shapes.validate_requests([request], origin)
    end

    test "doesn't reflect back table names that are unprintable", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [%SatShapeDef.Select{tablename: for(x <- 1..100, into: "", do: <<x::8>>)}]
        }
      }

      assert {:error, [{"id1", :TABLE_NOT_FOUND, "Invalid table name"}]} =
               Shapes.validate_requests([request], origin)
    end

    test "fails if no tables are selected", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: []
        }
      }

      assert {:error, [{"id1", :EMPTY_SHAPE_DEFINITION, "Empty shape requests are not allowed"}]} =
               Shapes.validate_requests([request], origin)
    end

    test "passes when selecting a table without it's FK targets because they are auto-filled", %{
      origin: origin
    } do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [%SatShapeDef.Select{tablename: "child"}]
        }
      }

      assert {:ok, [%Shapes.ShapeRequest{} = req]} =
               Shapes.validate_requests([request], origin)

      assert is_map_key(req.layer_map, {"public", "parent"})
    end

    test "passes when selecting a table with it's FK targets", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{
              tablename: "child",
              include: [
                %SatShapeDef.Relation{
                  foreign_key: ["parent_id"],
                  select: %SatShapeDef.Select{tablename: "parent"}
                }
              ]
            }
          ]
        }
      }

      assert {:ok, _} =
               Shapes.validate_requests([request], origin)
    end
  end

  describe "validate_requests/2 with where-claused requests" do
    setup do
      start_schema_cache([
        {
          "2023071300",
          [
            "CREATE TABLE public.entries (id uuid PRIMARY KEY);",
            "CREATE TABLE public.parent (id uuid PRIMARY KEY, value TEXT);",
            "CREATE TABLE public.child (id uuid PRIMARY KEY, parent_id uuid REFERENCES public.parent(id));"
          ]
        }
      ])
    end

    test "should fail on malformed queries", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{
              tablename: "parent",
              where: ~S|huh::boolean|
            }
          ]
        }
      }

      assert {:error,
              [
                {"id1", :INVALID_WHERE_CLAUSE, "At location 0: unknown reference huh"}
              ]} =
               Shapes.validate_requests([request], origin)
    end

    test "should fail on queries that don't return booleans", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{
              tablename: "parent",
              where: ~S|this.value|
            }
          ]
        }
      }

      assert {:error,
              [
                {"id1", :INVALID_WHERE_CLAUSE,
                 "Where expression should evaluate to a boolean, but it's :text"}
              ]} =
               Shapes.validate_requests([request], origin)
    end

    test "should save the query and the eval", %{origin: origin} do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{tablename: "parent", where: ~S|this.value LIKE 'hello%'|}
          ]
        }
      }

      assert {:ok, [%Shapes.ShapeRequest{} = request]} =
               Shapes.validate_requests([request], origin)

      assert %Layer{target_table: {_, "parent"}, where_target: where} = request.tree
      assert where.query == ~S|this.value LIKE 'hello%'|

      assert {:ok, true} = Eval.Runner.execute(where, %{["this", "value"] => "hello world"})
      assert {:ok, false} = Eval.Runner.execute(where, %{["this", "value"] => "goodbye world"})
    end
  end

  defp tx(changes), do: %Changes.Transaction{changes: changes}

  defp insert(rel \\ {"public", "entries"}, record),
    do: %Changes.NewRecord{relation: rel, record: record}

  defp update(rel \\ {"public", "entries"}, pk, old_record, record),
    do: %Changes.UpdatedRecord{
      relation: rel,
      old_record: Map.merge(pk, old_record),
      record: Map.merge(pk, record)
    }
end
