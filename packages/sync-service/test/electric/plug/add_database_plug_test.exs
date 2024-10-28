defmodule Electric.Plug.AddDatabasePlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn

  alias Electric.Plug.AddDatabasePlug

  import Support.ComponentSetup
  import Support.DbSetup

  alias Support.Mock

  import Mox

  setup :verify_on_exit!
  @moduletag :capture_log
  @moduletag :tmp_dir

  @conn_url "postgresql://postgres:password@foo:5432/electric"
  @other_conn_url "postgresql://postgres:password@bar:5432/electric"

  # setup do
  #  start_link_supervised!({Registry, keys: :duplicate, name: @registry})
  #  :ok
  # end

  def conn(ctx, method, body_params \\ nil) do
    # Pass mock dependencies to the plug
    config = [
      storage: {Mock.Storage, []},
      tenant_manager: Access.fetch!(ctx, :tenant_manager),
      app_config: ctx.app_config
    ]

    conn =
      if body_params do
        Plug.Test.conn(method, "/", body_params)
      else
        Plug.Test.conn(method, "/")
      end

    conn
    |> assign(:config, config)
  end

  describe "AddDatabasePlug" do
    setup :with_unique_db
    setup :with_publication

    setup do
      %{
        slot_name: "electric_test_slot",
        stream_id: "default"
      }
    end

    setup :with_complete_stack_but_no_tenant
    setup :with_app_config

    test "returns 400 for invalid params", ctx do
      conn =
        ctx
        |> conn("POST")
        |> AddDatabasePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) == %{
               "DATABASE_URL" => ["can't be blank"],
               "id" => ["can't be blank"]
             }
    end

    test "returns 200 when successfully adding a tenant", ctx do
      conn =
        ctx
        |> conn("POST", %{id: ctx.tenant_id, DATABASE_URL: @conn_url})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id
    end

    # Also test:
    # - error when database ID (i.e. tenant) already exists
    # - error when PG ID already exists (i.e combination of host, port and database already exists)

    test "returns 400 when tenant already exists", ctx do
      conn =
        ctx
        |> conn("POST", %{id: ctx.tenant_id, DATABASE_URL: @conn_url})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id

      # Now try creating another tenant with the same ID
      conn =
        ctx
        |> conn("POST", %{id: ctx.tenant_id, DATABASE_URL: @other_conn_url})
        |> AddDatabasePlug.call([])

      assert conn.status == 400
      assert Jason.decode!(conn.resp_body) == "Database #{ctx.tenant_id} already exists."
    end

    test "returns 400 when database is already in use", ctx do
      conn =
        ctx
        |> conn("POST", %{id: ctx.tenant_id, DATABASE_URL: @conn_url})
        |> AddDatabasePlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == ctx.tenant_id

      # Now try creating another tenant with the same database
      conn =
        ctx
        |> conn("POST", %{id: "other_tenant", DATABASE_URL: @conn_url})
        |> AddDatabasePlug.call([])

      assert conn.status == 400

      assert Jason.decode!(conn.resp_body) ==
               "The database foo:5432/electric is already in use by another tenant."
    end
  end
end
