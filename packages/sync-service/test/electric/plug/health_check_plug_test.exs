defmodule Electric.Plug.HealthCheckPlugTest do
  use ExUnit.Case, async: true
  import Plug.Conn
  alias Plug.Conn

  alias Electric.Plug.HealthCheckPlug

  @moduletag :capture_log

  @registry Registry.HealthCheckPlugTest

  setup do
    start_link_supervised!({Registry, keys: :duplicate, name: @registry})
    :ok
  end

  def conn(%{connection_status: connection_status} = _config) do
    # Pass mock dependencies to the plug
    config = %{
      get_service_status: fn -> connection_status end
    }

    Plug.Test.conn("GET", "/")
    |> assign(:config, config)
  end

  describe "HealthCheckPlug" do
    test "has appropriate content and cache headers" do
      conn =
        conn(%{connection_status: :waiting})
        |> HealthCheckPlug.call([])

      assert Conn.get_resp_header(conn, "content-type") == ["application/json"]

      assert Conn.get_resp_header(conn, "cache-control") == [
               "no-cache, no-store, must-revalidate"
             ]
    end

    test "returns 200 when in waiting mode" do
      conn =
        conn(%{connection_status: :waiting})
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "waiting"}
    end

    test "returns 200 when in starting mode" do
      conn =
        conn(%{connection_status: :starting})
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "starting"}
    end

    test "returns 200 when in active mode" do
      conn =
        conn(%{connection_status: :active})
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "active"}
    end

    test "returns 500 when stopping" do
      conn =
        conn(%{connection_status: :stopping})
        |> HealthCheckPlug.call([])

      assert conn.status == 500
      assert Jason.decode!(conn.resp_body) == %{"status" => "stopping"}
    end
  end
end
