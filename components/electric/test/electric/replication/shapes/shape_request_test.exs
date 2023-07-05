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
    setup [:setup_replicated_db, :create_electrified_tables, :execute_sql]
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

      assert {:ok,
              [
                %NewRecord{
                  relation: {"public", "my_entries"},
                  record: %{"content" => "test content"},
                  tags: [tag]
                }
              ]} = ShapeRequest.query_initial_data(request, conn, schema, origin)

      assert String.starts_with?(tag, origin)
    end
  end
end
