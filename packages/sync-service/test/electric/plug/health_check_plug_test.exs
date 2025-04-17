defmodule Electric.Plug.HealthCheckPlugTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  import Plug.Conn
  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  alias Plug.Conn
  alias Electric.Plug.HealthCheckPlug
  alias Electric.StatusMonitor

  setup :with_stack_id_from_test

  def conn(ctx) do
    config = [stack_id: ctx[:stack_id]]

    Repatch.patch(StatusMonitor, :status, [mode: :shared], fn stack_id ->
      assert stack_id == ctx[:stack_id]
      ctx.connection_status
    end)

    Plug.Test.conn("GET", "/")
    |> assign(:config, config)
  end

  describe "HealthCheckPlug" do
    @tag connection_status: :waiting
    test "has appropriate content and cache headers", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert Conn.get_resp_header(conn, "content-type") == ["application/json; charset=utf-8"]

      assert Conn.get_resp_header(conn, "cache-control") == [
               "no-cache, no-store, must-revalidate"
             ]
    end

    @tag connection_status: :waiting
    test "returns 202 when in waiting mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 202
      assert Jason.decode!(conn.resp_body) == %{"status" => "waiting"}
    end

    @tag connection_status: :starting
    test "returns 202 when in starting mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 202
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
  end
end
