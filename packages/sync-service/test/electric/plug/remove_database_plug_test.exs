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
      storage: {Mock.Storage, []},
      tenant_manager: Access.fetch!(ctx, :tenant_manager),
      app_config: ctx.app_config
    ]

    conn =
      if is_nil(database_id) do
        Plug.Test.conn(method, "/")
      else
        Plug.Test.conn(method, "/?database_id=#{database_id}")
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

    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("DELETE")
        |> RemoveDatabasePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "database_id" => ["can't be blank"]
             }
    end

    test "returns 200 when successfully deleting a tenant", ctx do
      conn =
        ctx
        |> conn("DELETE", ctx.tenant_id)
        |> RemoveDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id
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
