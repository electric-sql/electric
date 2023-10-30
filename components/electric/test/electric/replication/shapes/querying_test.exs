defmodule Electric.Replication.Shapes.QueryingTest do
  use ExUnit.Case, async: false
  import Electric.Postgres.TestConnection
  import Electric.Utils, only: [uuid4: 0]

  alias Electric.Replication.Shapes.ShapeRequest.Validation
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Eval
  alias Electric.Replication.Shapes.ShapeRequest.Layer
  alias Electric.Replication.Shapes.Querying

  describe "query_layer/6" do
    setup [:setup_replicated_db, :setup_electrified_tables, :setup_with_sql_execute]
    setup :load_schema

    @tag with_sql: """
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'test content');
         """
    test "should return one-level data", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      layer = %Layer{
        target_table: {"public", "my_entries"},
        target_pk: ["id"],
        key: "l1",
        direction: :first_layer,
        request_id: "test"
      }

      assert {:ok, results, %Graph{} = graph} =
               Querying.query_layer(conn, layer, schema, origin, %{})

      assert [{{"public", "my_entries"}, [id]}] = Map.keys(results)

      assert [
               {%NewRecord{
                  relation: {"public", "my_entries"},
                  record: %{"content" => "test content", "id" => ^id},
                  tags: [tag]
                }, ["test"]}
             ] = Map.values(results)

      assert String.starts_with?(tag, origin)
      assert Graph.edge(graph, :root, {{"public", "my_entries"}, [id]}, layer.key)
    end

    @john_doe_id uuid4()
    @jane_doe_id uuid4()

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES (gen_random_uuid(), '#{@john_doe_id}', 'First');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES (gen_random_uuid(), '#{@john_doe_id}', 'Second');
         """
    test "should return follow one-to-many relations when querying", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      layer = %Layer{
        target_table: {"public", "users"},
        target_pk: ["id"],
        key: "l1",
        direction: :first_layer,
        next_layers: [
          %Layer{
            source_table: {"public", "users"},
            source_pk: ["id"],
            parent_key: "l1",
            direction: :one_to_many,
            fk: ["author_id"],
            target_table: {"public", "authored_entries"},
            target_pk: ["id"],
            key: "l2"
          }
        ]
      }

      assert {:ok, results, graph} = Querying.query_layer(conn, layer, schema, origin)

      assert [
               %NewRecord{relation: {"public", "users"}, record: %{"name" => "John Doe"}},
               %NewRecord{
                 relation: {"public", "authored_entries"},
                 record: %{"content" => "First", "id" => id1}
               },
               %NewRecord{
                 relation: {"public", "authored_entries"},
                 record: %{"content" => "Second", "id" => id2}
               }
             ] = results_to_changes(results)

      user_id = {{"public", "users"}, [@john_doe_id]}
      assert Graph.edge(graph, :root, user_id, "l1")
      assert Graph.edge(graph, user_id, {{"public", "authored_entries"}, [id1]}, "l2")
      assert Graph.edge(graph, user_id, {{"public", "authored_entries"}, [id2]}, "l2")
    end

    @entry_id uuid4()

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{@jane_doe_id}', 'Jane Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'First');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES (gen_random_uuid(), '#{@john_doe_id}', 'Second');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES (gen_random_uuid(), '#{@jane_doe_id}', 'Second');
         INSERT INTO public.comments (id, entry_id, content) VALUES (gen_random_uuid(), '#{@entry_id}', 'comment');
         INSERT INTO public.comments (id, entry_id, content) VALUES (gen_random_uuid(), '#{@entry_id}', 'second comment');
         """
    test "should return follow one-to-many relations over multiple levels when querying", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      {:ok, where} =
        Validation.validate_where("this.id = '#{@john_doe_id}'",
          for: {"public", "users"},
          schema: schema
        )

      layer = %Layer{
        target_table: {"public", "users"},
        target_pk: ["id"],
        key: "l1",
        direction: :first_layer,
        where_target: where,
        next_layers: [
          %Layer{
            source_table: {"public", "users"},
            source_pk: ["id"],
            parent_key: "l1",
            direction: :one_to_many,
            fk: ["author_id"],
            target_table: {"public", "authored_entries"},
            target_pk: ["id"],
            key: "l2",
            next_layers: [
              %Layer{
                source_table: {"public", "authored_entries"},
                source_pk: ["id"],
                parent_key: "l2",
                direction: :one_to_many,
                fk: ["entry_id"],
                target_table: {"public", "comments"},
                target_pk: ["id"],
                key: "l3",
                where_target: %Eval.Expr{query: "this.content ILIKE 'comm%'"}
              }
            ]
          }
        ]
      }

      # We're NOT seeing either "Jane Doe", or her authored entry, or the filtered out "second comment"
      assert {:ok, results, graph} = Querying.query_layer(conn, layer, schema, origin)

      assert [
               %NewRecord{relation: {"public", "users"}, record: %{"name" => "John Doe"}},
               %NewRecord{
                 relation: {"public", "authored_entries"},
                 record: %{"content" => "First"}
               },
               %NewRecord{
                 relation: {"public", "authored_entries"},
                 record: %{"content" => "Second", "id" => id2}
               },
               %NewRecord{
                 relation: {"public", "comments"},
                 record: %{"content" => "comment", "id" => id3}
               }
             ] = results_to_changes(results)

      user_id = {{"public", "users"}, [@john_doe_id]}
      entry_id = {{"public", "authored_entries"}, [@entry_id]}
      assert Graph.edge(graph, :root, user_id, "l1")
      assert Graph.edge(graph, user_id, entry_id, "l2")
      assert Graph.edge(graph, user_id, {{"public", "authored_entries"}, [id2]}, "l2")
      assert Graph.edge(graph, entry_id, {{"public", "comments"}, [id3]}, "l3")
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('#{@john_doe_id}', 'John Doe');
         INSERT INTO public.users (id, name) VALUES ('#{uuid4()}', 'Jane Doe');
         INSERT INTO public.authored_entries (id, author_id, content) VALUES ('#{@entry_id}', '#{@john_doe_id}', 'First');
         """
    test "should follow many-to-one relations when querying", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      layer = %Layer{
        target_table: {"public", "authored_entries"},
        target_pk: ["id"],
        key: "l1",
        direction: :first_layer,
        next_layers: [
          %Layer{
            source_table: {"public", "authored_entries"},
            source_pk: ["id"],
            parent_key: "l1",
            direction: :many_to_one,
            fk: ["author_id"],
            target_table: {"public", "users"},
            target_pk: ["id"],
            key: "l2"
          }
        ]
      }

      assert {:ok, results, graph} = Querying.query_layer(conn, layer, schema, origin)

      assert [
               %NewRecord{relation: {"public", "users"}, record: %{"name" => "John Doe"}},
               %NewRecord{
                 relation: {"public", "authored_entries"},
                 record: %{"content" => "First"}
               }
             ] = results_to_changes(results)

      user_id = {{"public", "users"}, [@john_doe_id]}
      entry_id = {{"public", "authored_entries"}, [@entry_id]}
      assert Graph.edge(graph, :root, entry_id, "l1")
      assert Graph.edge(graph, entry_id, user_id, "l2")
    end
  end

  defp results_to_changes(results),
    do: Enum.map(results, fn {_, {change, _}} -> change end) |> Enum.sort()
end
