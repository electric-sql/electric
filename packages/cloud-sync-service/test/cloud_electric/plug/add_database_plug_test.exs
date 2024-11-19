defmodule CloudElectric.Plugs.AddDatabasePlugTest do
  use ExUnit.Case, async: false
  import Plug.Conn

  alias CloudElectric.Plugs.AddDatabasePlug

  import Support.ComponentSetup
  import Support.DbSetup

  @moduletag :capture_log
  @moduletag :tmp_dir

  setup_all :with_persistent_kv
  setup :with_unique_dbs
  setup :with_tenant_supervisor
  setup :with_tenant_manager

  def conn(ctx, method, body_params \\ nil) do
    Plug.Test.conn(method, "/", body_params)
    |> assign(:config, tenant_manager: ctx.tenant_manager)
  end

  describe "AddDatabasePlug" do
    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("POST")
        |> AddDatabasePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "database_url" => ["can't be blank"],
               "database_id" => ["can't be blank"]
             }
    end

    @tag db_count: 1
    test "returns 200 when successfully adding a tenant", %{dbs: [%{url: url}]} = ctx do
      conn =
        ctx
        |> conn("POST", %{database_id: "db1", database_url: url})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == "db1"
      assert_receive {:startup_progress, "db1", :shape_supervisor_ready}, 500
    end

    @tag db_count: 2
    test "returns 400 when tenant already exists", %{dbs: [%{url: url1}, %{url: url2}]} = ctx do
      tenant_id = "new-db"

      conn =
        ctx
        |> conn("POST", %{database_id: tenant_id, database_url: url1})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == tenant_id

      # Now try creating another tenant with the same ID
      conn =
        ctx
        |> conn("POST", %{database_id: tenant_id, database_url: url2})
        |> AddDatabasePlug.call([])

      assert conn.status == 400
      assert Jason.decode!(conn.resp_body) == "Database #{tenant_id} already exists."
    end

    @tag db_count: 1
    test "returns 400 when database is already in use", %{dbs: [%{url: url}]} = ctx do
      tenant_id = "new-db"

      conn =
        ctx
        |> conn("POST", %{database_id: tenant_id, database_url: url})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == tenant_id

      # Now try creating another tenant with the same database
      conn =
        ctx
        |> conn("POST", %{database_id: "other_tenant", database_url: url})
        |> AddDatabasePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) =~
               ~r/The database .* is already in use by another tenant./
    end
  end
end
