defmodule Electric.Replication.Shapes.ShapeRequestTest do
  use ExUnit.Case, async: false
  import Electric.Postgres.TestConnection

  alias Electric.Replication.Eval.Parser
  alias Electric.Replication.Shapes
  use Electric.Satellite.Protobuf
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Replication.Changes.NewRecord
  alias Electric.Replication.Changes.UpdatedRecord

  describe "change_belongs_to_shape?/2" do
    test "for full-table requests, verifies that change belongs to one of the tables" do
      shape = %ShapeRequest{
        included_tables: [{"public", "entries"}]
      }

      assert ShapeRequest.record_belongs_to_shape?(shape, {"public", "entries"}, %{})

      refute ShapeRequest.record_belongs_to_shape?(shape, {"public", "other"}, %{})
    end

    test "for requests with where clauses, tries executing the where statement" do
      shape = %ShapeRequest{
        included_tables: [{"public", "entries"}],
        where: %{
          {"public", "entries"} =>
            Parser.parse_and_validate_expression!("this.value > 10", %{["this", "value"] => :int4})
        }
      }

      assert ShapeRequest.record_belongs_to_shape?(shape, {"public", "entries"}, %{
               "value" => "11"
             })

      refute ShapeRequest.record_belongs_to_shape?(shape, {"public", "entries"}, %{"value" => "9"})
    end

    test "for requests with where clauses, returns false when failing to parse record" do
      shape = %ShapeRequest{
        included_tables: [{"public", "entries"}],
        where: %{
          {"public", "entries"} =>
            Parser.parse_and_validate_expression!("this.value > 10", %{["this", "value"] => :int4})
        }
      }

      refute ShapeRequest.record_belongs_to_shape?(shape, {"public", "entries"}, %{
               "value" => "not int"
             })
    end
  end

  describe "get_update_position_in_shape/2" do
    setup _ do
      [
        shape: %ShapeRequest{
          included_tables: [{"public", "entries"}],
          where: %{
            {"public", "entries"} =>
              Parser.parse_and_validate_expression!("this.value > 10", %{
                ["this", "value"] => :int4
              })
          }
        }
      ]
    end

    test "should mark update as not in shape if neither old nor new record matches the where clause",
         ctx do
      change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "1"},
        record: %{"value" => "2"}
      }

      assert :not_in == ShapeRequest.get_update_position_in_shape(ctx.shape, change)
    end

    test "should mark update as in shape if both old and new records match the where clause",
         ctx do
      change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "11"},
        record: %{"value" => "12"}
      }

      assert :in == ShapeRequest.get_update_position_in_shape(ctx.shape, change)
    end

    test "should mark update as moving into shape if old doesn't match the where clause, but new does",
         ctx do
      change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "1"},
        record: %{"value" => "12"}
      }

      assert :move_in == ShapeRequest.get_update_position_in_shape(ctx.shape, change)
    end

    test "should mark update as moving out of shape if old does match the where clause, but new doesn't",
         ctx do
      change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "11"},
        record: %{"value" => "1"}
      }

      assert :move_out == ShapeRequest.get_update_position_in_shape(ctx.shape, change)
    end

    test "should mark update as an error if either of records cannot be parsed into Elixir types",
         ctx do
      change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "not int"},
        record: %{"value" => "1"}
      }

      other_change = %UpdatedRecord{
        relation: {"public", "entries"},
        old_record: %{"value" => "1"},
        record: %{"value" => "not int"}
      }

      assert :error == ShapeRequest.get_update_position_in_shape(ctx.shape, change)
      assert :error == ShapeRequest.get_update_position_in_shape(ctx.shape, other_change)
    end
  end

  describe "from_satellite_request/2" do
    test "builds a ShapeRequest struct for a basic full-table request, filling schemas" do
      assert %ShapeRequest{id: "id", included_tables: [{"public", "test"}]} =
               ShapeRequest.from_satellite_request(
                 %SatShapeReq{
                   request_id: "id",
                   shape_definition: %SatShapeDef{
                     selects: [%SatShapeDef.Select{tablename: "test"}]
                   }
                 },
                 %{}
               )
    end
  end

  describe "query_initial_data/3" do
    setup [:setup_replicated_db, :setup_electrified_tables, :setup_with_sql_execute]
    setup :load_schema

    @tag with_sql: """
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'test content');
         """
    test "should be able to fulfill full-table request", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      request = %ShapeRequest{id: "id", included_tables: [{"public", "my_entries"}]}

      assert {:ok, 1,
              [
                %NewRecord{
                  relation: {"public", "my_entries"},
                  record: %{"content" => "test content"},
                  tags: [tag]
                }
              ]} = ShapeRequest.query_initial_data(request, conn, schema, origin)

      assert String.starts_with?(tag, origin)
    end

    @tag with_sql: """
         INSERT INTO public.users (id, name) VALUES ('00000000-0000-0000-0000-000000000000', 'user 1');
         INSERT INTO public.users (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'user 2');
         INSERT INTO public.documents (id, title, electric_user_id) VALUES ('00000000-0000-0000-0000-000000000000', 'test', '00000000-0000-0000-0000-000000000000')
         """
    test "full table request respects `electric_user_id` ownership filtering", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      request = %ShapeRequest{id: "id", included_tables: [{"public", "documents"}]}
      base_context = ShapeRequest.prepare_filtering_context([])

      assert {:ok, 1, [%NewRecord{}]} =
               ShapeRequest.query_initial_data(
                 request,
                 conn,
                 schema,
                 origin,
                 Map.merge(base_context, %{
                   user_id: "00000000-0000-0000-0000-000000000000"
                 })
               )

      assert {:ok, 0, []} =
               ShapeRequest.query_initial_data(
                 request,
                 conn,
                 schema,
                 origin,
                 Map.merge(base_context, %{
                   user_id: "00000000-0000-0000-0000-000000000001"
                 })
               )
    end

    @tag with_sql: """
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'test content');
         """
    test "should not fulfill full-table requests if the table has already been sent", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      request = %ShapeRequest{id: "id", included_tables: [{"public", "my_entries"}]}

      assert {:ok, 0, []} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, %{
                 fully_sent_tables: MapSet.new([{"public", "my_entries"}]),
                 applied_where_clauses: %{}
               })
    end

    @tag with_sql: """
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'test content');
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'my content');
         """
    test "should correctly apply where clauses", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      select = %SatShapeDef.Select{tablename: "my_entries", where: "this.content LIKE 'test%'"}

      {:ok, [request]} =
        Shapes.validate_requests(
          [%SatShapeReq{shape_definition: %SatShapeDef{selects: [select]}}],
          origin
        )

      context = ShapeRequest.prepare_filtering_context([])

      assert {:ok, 1, [%{record: %{"content" => "test content"}}]} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, context)
    end

    @tag with_sql: """
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'test content');
         INSERT INTO public.my_entries (id, content) VALUES (gen_random_uuid(), 'my content');
         """
    test "should correctly apply inverse of already sent where clauses", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      old_request = %ShapeRequest{
        included_tables: [{"public", "my_entries"}],
        where: %{{"public", "my_entries"} => %{query: "content LIKE 'test%'"}}
      }

      context = ShapeRequest.prepare_filtering_context([old_request])

      select = %SatShapeDef.Select{tablename: "my_entries", where: "this.content LIKE '%content'"}

      {:ok, [request]} =
        Shapes.validate_requests(
          [%SatShapeReq{shape_definition: %SatShapeDef{selects: [select]}}],
          origin
        )

      assert {:ok, 1, [%{record: %{"content" => "my content"}}]} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, context)
    end
  end
end
