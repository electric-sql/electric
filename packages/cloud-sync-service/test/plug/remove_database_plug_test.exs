defmodule Electric.Plug.RemoveDatabasePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.RemoveDatabasePlug

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.TestUtils, only: [with_electric_instance_id: 1]

  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  @moduletag :capture_log
  @moduletag :tmp_dir

  def conn(ctx, method, database_id \\ nil) do
    # Pass mock dependencies to the plug
    config = [
      electric_instance_id: ctx.electric_instance_id,
      tenant_id: ctx.tenant_id,
      storage: {Mock.Storage, []},
      tenant_manager: Access.fetch!(ctx, :tenant_manager),
      app_config: ctx.app_config
    ]

    conn =
      if is_nil(database_id) do
        Plug.Test.conn(method, "/")
      else
        Plug.Test.conn(method, "/#{database_id}")
        |> Map.update!(:path_params, &Map.put(&1, "database_id", database_id))
      end

    conn
    |> assign(:config, config)
  end

  describe "RemoveDatabasePlug" do
    setup :with_unique_db
    setup :with_publication

    setup do
      %{
        slot_name: "electric_remove_db_test_slot",
        stream_id: "default"
      }
    end

    setup :with_electric_instance_id
    setup :with_tenant_id
    setup :with_registry
    setup :with_persistent_kv
    setup :with_tenant_tables
    setup :with_app_config
    setup :with_tenant_manager
    setup :with_supervised_tenant

    test "returns 200 when successfully deleting a tenant", ctx do
      conn =
        ctx
        |> conn("DELETE", ctx.tenant_id)
        |> RemoveDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id

      # Ensure the publication has been dropped
      assert %{rows: []} = Postgrex.query!(ctx.db_conn, "SELECT pubname FROM pg_publication", [])
    end

    test "returns 404 when tenant is not found", ctx do
      tenant = "non-existing tenant"

      conn =
        ctx
        |> conn("DELETE", tenant)
        |> RemoveDatabasePlug.call([])

      assert conn.status == 404
      assert Jason.decode!(conn.resp_body) == "Database #{tenant} not found."
    end
  end
end
