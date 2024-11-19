defmodule CloudElectric.ControlPlaneTest do
  alias CloudElectric.ControlPlane
  use ExUnit.Case, async: false

  setup ctx do
    %{
      plane: Support.ComponentSetup.make_fixed_response_control_plane(ctx.plug_response)
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
