defmodule Electric.ControlPlaneTest do
  alias Electric.ControlPlane
  use ExUnit.Case, async: true

  setup ctx do
    %{
      plane: %ControlPlane{
        base_url: "http://localhost",
        req_opts: [
          plug: fn conn ->
            conn
            |> Plug.Conn.put_resp_content_type("application/json")
            |> Plug.Conn.put_resp_header("electric-up-to-date", "true")
            |> Plug.Conn.send_resp(200, Jason.encode!(ctx.plug_response))
          end
        ]
      }
    }
  end

  describe "list_tenants/2" do
    @tag plug_response: [
           %{
             headers: %{operation: "insert"},
             key: "id1",
             value: %{
               id: "test_id",
               connection_url: "postgresql://test:me@localhost:5432/postgres"
             }
           }
         ]
    test "returns tenants from an Electric API", %{plane: plane} do
      assert {:ok,
              [
                %{
                  "connection_url" => "postgresql://test:me@localhost:5432/postgres",
                  "id" => "test_id"
                }
              ],
              []} = ControlPlane.list_tenants(plane, app_config: %{electric_instance_id: "test"})
    end
  end
end
