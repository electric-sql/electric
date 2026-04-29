defmodule Electric.Plug.ServeShapePlugLoggingTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  alias Electric.Plug.ServeShapePlug
  alias Electric.Shapes.Api

  import Support.ComponentSetup
  import Support.TestUtils, only: [set_status_to_active: 1]

  @inspector Support.StubInspector.new(
               tables: ["users"],
               columns: [
                 %{name: "id", type: "int8", pk_position: 0, type_id: {20, 1}},
                 %{name: "value", type: "text", pk_position: nil, type_id: {28, 1}}
               ]
             )
  @moduletag :tmp_dir

  setup [:with_stack_id_from_test, :with_status_monitor]

  setup ctx do
    set_status_to_active(ctx)
    :ok
  end

  def conn(_ctx, method, params, "?" <> _ = query_string) do
    Plug.Test.conn(method, "/" <> query_string, params)
  end

  defp build_plug_opts(ctx) do
    Api.plug_opts(stack_id: ctx.stack_id, inspector: @inspector, stack_ready_timeout: 100)
  end

  defp call_serve_shape_plug(conn, ctx) do
    ServeShapePlug.call(conn, build_plug_opts(ctx))
  end

  test "redacts sensitive query params in debug logs", ctx do
    previous_level = Logger.level()
    on_exit(fn -> Logger.configure(level: previous_level) end)
    Logger.configure(level: :debug)

    log =
      capture_log([level: :debug], fn ->
        conn =
          ctx
          |> conn(
            :get,
            %{"table" => ".invalid_shape"},
            "?offset=-1&secret=topsecret&api_secret=legacy&token=abc123&table=users"
          )
          |> call_serve_shape_plug(ctx)

        assert conn.status == 400
      end)

    assert log =~ "Query String:"
    assert log =~ "secret=[REDACTED]"
    assert log =~ "api_secret=[REDACTED]"
    assert log =~ "token=[REDACTED]"
    refute log =~ "topsecret"
    refute log =~ "legacy"
    refute log =~ "abc123"
  end
end
