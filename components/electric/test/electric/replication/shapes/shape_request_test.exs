defmodule Electric.Replication.Shapes.ShapeRequestTest do
  use ExUnit.Case, async: false
  import Electric.Postgres.TestConnection

  use Electric.Satellite.Protobuf
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Replication.Changes.NewRecord

  describe "change_belongs_to_shape?/2" do
    test "for full-table requests, verifies that change belongs to one of the tables" do
      shape = %ShapeRequest{
        included_tables: [{"public", "entries"}]
      }

      assert ShapeRequest.change_belongs_to_shape?(shape, %NewRecord{
               relation: {"public", "entries"}
             })

      refute ShapeRequest.change_belongs_to_shape?(shape, %NewRecord{
               relation: {"public", "other`"}
             })
    end
  end

  describe "from_satellite_request/1" do
    test "builds a ShapeRequest struct for a basic full-table request, filling schemas" do
      assert %ShapeRequest{id: "id", included_tables: [{"public", "test"}]} =
               ShapeRequest.from_satellite_request(%SatShapeReq{
                 request_id: "id",
                 shape_definition: %SatShapeDef{
                   selects: [%SatShapeDef.Select{tablename: "test"}]
                 }
               })
    end
  end

  describe "query_initial_data/3" do
    setup [:setup_replicated_db, :setup_electrified_tables, :setup_with_sql_execute]
    setup :load_schema

    @tag with_sql: """
         INSERT INTO public.my_entries (content) VALUES ('test content');
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

      assert {:ok, 1, [%NewRecord{}]} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, %{
                 user_id: "00000000-0000-0000-0000-000000000000"
               })

      assert {:ok, 0, []} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, %{
                 user_id: "00000000-0000-0000-0000-000000000001"
               })
    end

    @tag with_sql: """
         INSERT INTO public.my_entries (content) VALUES ('test content');
         """
    test "should not fulfill full-table requests if the table has already been sent", %{
      origin: origin,
      conn: conn,
      schema: schema
    } do
      request = %ShapeRequest{id: "id", included_tables: [{"public", "my_entries"}]}

      assert {:ok, 0, []} =
               ShapeRequest.query_initial_data(request, conn, schema, origin, %{
                 sent_tables: MapSet.new([{"public", "my_entries"}])
               })
    end
  end
end
