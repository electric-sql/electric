defmodule Electric.Plug.RemoveDatabasePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.RemoveDatabasePlug

  import Support.ComponentSetup
  import Support.DbSetup

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

    setup :with_complete_stack
    setup :with_app_config

    test "returns 200 when successfully deleting a tenant", ctx do
      # The tenant manager will try to shut down the tenant supervisor
      # but we did not start a tenant supervisor in this test
      # so we create one here
      supervisor_name = Electric.Tenant.Supervisor.name(ctx.electric_instance_id, ctx.tenant_id)
      Supervisor.start_link([], name: supervisor_name, strategy: :one_for_one)

      conn =
        ctx
        |> conn("DELETE", ctx.tenant_id)
        |> RemoveDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id

      assert Electric.Tenant.Persistence.load_tenants!(
               app_config: ctx.app_config,
               electric_instance_id: ctx.electric_instance_id
             ) == %{}
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
