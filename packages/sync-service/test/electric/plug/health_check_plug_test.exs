defmodule Electric.Plug.HealthCheckPlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn
  alias Plug.Conn

  alias Electric.Plug.HealthCheckPlug

  @moduletag :capture_log

  def conn(ctx) do
    # Pass mock dependencies to the plug
    config = [get_service_status: fn -> ctx.connection_status end]

    Plug.Test.conn("GET", "/")
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
