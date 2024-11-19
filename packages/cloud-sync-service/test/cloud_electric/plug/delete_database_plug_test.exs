defmodule CloudElectric.Plugs.DeleteDatabasePlugTest do
  use ExUnit.Case, async: false
  import Plug.Conn

  alias CloudElectric.TenantManager
  alias CloudElectric.Plugs.DeleteDatabasePlug

  import Support.ComponentSetup
  import Support.DbSetup

  @moduletag :capture_log
  @moduletag :tmp_dir

  setup_all :with_persistent_kv
  setup :with_unique_dbs
  setup :with_tenant_supervisor
  setup :with_tenant_manager

  def conn(ctx, method, database_id \\ nil) do
    conn =
      if is_nil(database_id) do
        Plug.Test.conn(method, "/")
      else
        Plug.Test.conn(method, "/#{database_id}")
        |> Map.update!(:path_params, &Map.put(&1, "database_id", database_id))
      end

    conn
    |> assign(:config, tenant_manager: ctx.tenant_manager)
  end

  describe "RemoveDatabasePlug" do
    @describetag db_count: 1
    setup %{dbs: [%{db_config: config}], tenant_manager: tenant_manager} do
      assert :ok =
               TenantManager.create_tenant("tenant-id-1", config, tenant_manager: tenant_manager)

      assert_receive {:startup_progress, "tenant-id-1", :shape_supervisor_ready}, 500

      %{tenant_id: "tenant-id-1"}
    end

    test "returns 200 when successfully deleting a tenant", %{dbs: [%{pool: db_conn}]} = ctx do
      conn =
        ctx
        |> conn("DELETE", ctx.tenant_id)
        |> DeleteDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id

      # Ensure the publication has been dropped
      assert %{rows: []} = Postgrex.query!(db_conn, "SELECT pubname FROM pg_publication", [])
    end

    test "returns 404 when tenant is not found", ctx do
      tenant = "non-existing tenant"

      conn =
        ctx
        |> conn("DELETE", tenant)
        |> DeleteDatabasePlug.call([])

      assert conn.status == 404
      assert Jason.decode!(conn.resp_body) == "Database #{tenant} not found."
    end
  end
end
