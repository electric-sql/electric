defmodule Electric.Plug.HealthCheckPlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn
  import Support.ComponentSetup
  import Support.TestUtils
  alias Plug.Conn

  alias Electric.Plug.HealthCheckPlug

  @moduletag :capture_log

  @registry Registry.HealthCheckPlugTest

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  setup :with_electric_instance_id
  setup :with_tenant_id
  setup :with_persistent_kv
  setup :with_minimal_app_config
  setup :with_tenant_manager

  setup ctx do
    tenant = [
      electric_instance_id: ctx.electric_instance_id,
      tenant_id: ctx.tenant_id,
      pg_id: "foo",
      registry: @registry,
      get_service_status: fn -> ctx.connection_status end
    ]

    store_tenant(tenant, ctx)
    %{}
  end

  def conn(ctx) do
    # Pass mock dependencies to the plug
    config = [
      electric_instance_id: ctx.electric_instance_id,
      tenant_manager: ctx.tenant_manager
    ]

    Plug.Test.conn("GET", "/?database_id=#{ctx.tenant_id}")
    |> assign(:config, config)
  end

  describe "HealthCheckPlug" do
    @tag connection_status: :waiting
    test "has appropriate content and cache headers", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert Conn.get_resp_header(conn, "content-type") == ["application/json"]

      assert Conn.get_resp_header(conn, "cache-control") == [
               "no-cache, no-store, must-revalidate"
             ]
    end

    @tag connection_status: :waiting
    test "returns 503 when in waiting mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 503
      assert Jason.decode!(conn.resp_body) == %{"status" => "waiting"}
    end

    @tag connection_status: :starting
    test "returns 503 when in starting mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 503
      assert Jason.decode!(conn.resp_body) == %{"status" => "starting"}
    end

    @tag connection_status: :active
    test "returns 200 when in active mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "active"}
    end

    @tag connection_status: :stopping
    test "returns 503 when stopping", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 503
      assert Jason.decode!(conn.resp_body) == %{"status" => "stopping"}
    end
  end
end
