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
    @tag connection_status: %{conn: :waiting_on_lock, shape: :starting}
    test "has appropriate content and cache headers", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert Conn.get_resp_header(conn, "content-type") == ["application/json; charset=utf-8"]

      assert Conn.get_resp_header(conn, "cache-control") == [
               "no-cache, no-store, must-revalidate"
             ]
    end

    @tag connection_status: %{conn: :waiting_on_lock, shape: :starting}
    test "returns 202 when waiting on the lock", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 202
      assert Jason.decode!(conn.resp_body) == %{"status" => "waiting"}
    end

    @tag connection_status: %{conn: :starting, shape: :starting}
    test "returns 202 when conn is starting", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 202
      assert Jason.decode!(conn.resp_body) == %{"status" => "starting"}
    end

    @tag connection_status: %{conn: :up, shape: :starting}
    test "returns 202 when shape is starting", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 202
      assert Jason.decode!(conn.resp_body) == %{"status" => "starting"}
    end

    @tag connection_status: %{conn: :up, shape: :up}
    test "returns 200 when in active mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "active"}
    end

    @tag connection_status: %{conn: :sleeping, shape: :up}
    test "returns 200 when in scaled-down mode", ctx do
      conn =
        conn(ctx)
        |> HealthCheckPlug.call([])

      assert conn.status == 200
      assert Jason.decode!(conn.resp_body) == %{"status" => "active"}
    end
  end
end
