defmodule Electric.Plug.RemoveAllDatabasesPlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.RemoveAllDatabasesPlug

  import Support.ComponentSetup
  import Support.DbSetup
  import Support.TestUtils, only: [with_electric_instance_id: 1]

  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  @moduletag :capture_log
  @moduletag :tmp_dir

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
    # TODO: Create multiple tenants in this test once multiple tenants per database
    # are supported (https://github.com/electric-sql/electric/pull/1966)
    setup :with_supervised_tenant

    test "returns 200 when successfully deleting all tenants", ctx do
      config = [
        electric_instance_id: ctx.electric_instance_id,
        tenant_id: ctx.tenant_id,
        storage: {Mock.Storage, []},
        tenant_manager: Access.fetch!(ctx, :tenant_manager),
        app_config: ctx.app_config
      ]

      conn =
        Plug.Test.conn("DELETE", "/")
        |> assign(:config, config)
        |> RemoveAllDatabasesPlug.call([])

      assert conn.status == 200

      assert Electric.Tenant.Persistence.load_tenants!(
               app_config: ctx.app_config,
               electric_instance_id: ctx.electric_instance_id
             ) == %{}

      # Ensure all publications have been dropped
      assert %{rows: []} = Postgrex.query!(ctx.db_conn, "SELECT pubname FROM pg_publication", [])
    end
  end
end
