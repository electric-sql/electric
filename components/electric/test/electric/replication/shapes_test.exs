defmodule Electric.Replication.ShapesTest do
  use ExUnit.Case, async: true

  use Electric.Satellite.Protobuf
  import ElectricTest.SetupHelpers

  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Gone
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.ReferencedRecord
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

    test "passes through migrations statements as-is and keeps the order", ctx do
      insert1 =
        insert({"electric", "ddl_commands"}, %{"id" => "1", "query" => "CREATE TABLE projects"})

      insert2 =
        insert({"electric", "ddl_commands"}, %{"id" => "2", "query" => "CREATE TABLE issues"})

      tx = tx([insert1, insert2])

      assert {%{changes: [^insert1, ^insert2]}, graph, _} =
               Shapes.process_transaction(tx, Graph.new(), [ctx.shape, ctx.second_shape])

      assert Graph.new() == graph
    end

    test "server compensations should not leak through" do
      comment_author_l = %Layer{
        source_table: {"public", "comments"},
        source_pk: ["id"],
        target_table: {"public", "users"},
        target_pk: ["id"],
        direction: :many_to_one,
        fk: ["author_id"],
        key: "comment_author_l",
        parent_key: "issue_comments_l"
      }

      issue_comments_l = %Layer{
        source_table: {"public", "issues"},
        source_pk: ["id"],
        target_table: {"public", "comments"},
        target_pk: ["id"],
        direction: :one_to_many,
        fk: ["issue_id"],
        key: "issue_comments_l",
        parent_key: "issues_l",
        next_layers: [comment_author_l]
      }

      project_account_l = %Layer{
        source_table: {"public", "projects"},
        source_pk: ["id"],
        target_table: {"public", "accounts"},
        target_pk: ["id"],
        direction: :many_to_one,
        fk: ["account_id"],
        key: "project_account_l",
        parent_key: "issue_project_l"
      }

      issue_project_l = %Layer{
        source_table: {"public", "issues"},
        source_pk: ["id"],
        target_table: {"public", "projects"},
        target_pk: ["id"],
        direction: :many_to_one,
        fk: ["project_id"],
        key: "issue_project_l",
        parent_key: "issues_l",
        next_layers: [project_account_l]
      }

      issue_l = %Layer{
        source_table: nil,
        source_pk: nil,
        target_table: {"public", "issues"},
        target_pk: ["id"],
        direction: :first_layer,
        fk: nil,
        key: "issues_l",
        parent_key: nil,
        next_layers: [issue_comments_l, issue_project_l]
      }

      shape = %ShapeRequest{
        hash: "anything",
        id: "r1",
        tree: issue_l,
        layer_map: %{
          {"public", "issues"} => [issue_l],
          {"public", "projects"} => [issue_project_l],
          {"public", "accounts"} => [project_account_l],
          {"public", "comments"} => [issue_comments_l],
          {"public", "users"} => [comment_author_l]
        }
      }

      incoming_txn = %Changes.Transaction{
        changes: [
          %NewRecord{
            relation: {"public", "comments"},
            record: %{"author_id" => "u1", "id" => "c1", "issue_id" => "i1"}
          }
        ],
        referenced_records: %{
          {"public", "accounts"} => %{
            ["acc1"] => %ReferencedRecord{
              relation: {"public", "accounts"},
              record: %{"id" => "acc1", "name" => "Electric"},
              pk: ["acc1"]
            }
          },
          {"public", "issues"} => %{
            ["i1"] => %ReferencedRecord{
              relation: {"public", "issues"},
              record: %{"id" => "i1", "name" => "Issue 2", "project_id" => "pr1"},
              pk: ["i1"]
            }
          },
          {"public", "projects"} => %{
            ["pr1"] => %ReferencedRecord{
              relation: {"public", "projects"},
              record: %{"account_id" => "acc1", "id" => "pr1", "name" => "Project 2"},
              pk: ["pr1"]
            }
          },
          {"public", "users"} => %{
            ["u1"] => %ReferencedRecord{
              relation: {"public", "users"},
              record: %{"id" => "u1", "name" => "Not Nobody"},
              pk: ["u1"]
            }
          }
        }
      }

      assert {%{changes: changes}, graph, _} =
               Shapes.process_transaction(incoming_txn, Graph.new(), [shape])

      assert [] = changes
      assert Graph.new() == graph
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
        },
        {
          "2024031901",
          [
            "CREATE TABLE public.tags (id uuid PRIMARY KEY, tag TEXT);",
            "CREATE TABLE public.child_tags (id uuid PRIMARY KEY, child_id uuid REFERENCES child(id), tag_id uuid REFERENCES tags(id));"
          ]
        },
        {
          "2024031902",
          [
            "CREATE TABLE public.workspaces (id uuid PRIMARY KEY);",
            "CREATE TABLE public.projects (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id));",
            "CREATE TABLE public.issues (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id));",
            "CREATE TABLE public.comments (id uuid PRIMARY KEY, issue_id uuid REFERENCES issues(id));",
            "CREATE TABLE public.reactions (id uuid PRIMARY KEY, comment_id uuid REFERENCES comments(id));"
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

      assert {:error, [{"id1", :TABLE_NOT_FOUND, "Unknown table \"public\".\"who knows\""}]} =
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

    test "passes and auto fills many-to-many relations", %{
      origin: origin
    } do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{
              tablename: "child",
              include: [
                %SatShapeDef.Relation{
                  foreign_key: ["child_id"],
                  select: %SatShapeDef.Select{tablename: "child_tags"}
                }
              ]
            }
          ]
        }
      }

      assert {:ok, [%Shapes.ShapeRequest{} = req]} =
               Shapes.validate_requests([request], origin)

      for relation <- [{"public", "child_tags"}, {"public", "tags"}] do
        assert is_map_key(req.layer_map, relation)
      end
    end

    test "traverses down to a permissions scope", %{
      origin: origin
    } do
      request = %SatShapeReq{
        request_id: "id1",
        shape_definition: %SatShapeDef{
          selects: [
            %SatShapeDef.Select{
              tablename: "issues"
            }
          ]
        }
      }

      assert {:ok, [%Shapes.ShapeRequest{} = req]} = Shapes.validate_requests([request], origin)

      for relation <- [{"public", "projects"}, {"public", "workspaces"}] do
        assert is_map_key(req.layer_map, relation)
      end
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
