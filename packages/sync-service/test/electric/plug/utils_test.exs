defmodule Electric.Plug.UtilsTest do
  alias Electric.Plug.Utils
  import Support.ComponentSetup
  use ExUnit.Case, async: true
  doctest Utils, import: true

  describe "hold_conn_until_stack_ready/2" do
    setup :with_stack_id_from_test

    test "immediately releases connection if stack ready", ctx do
      {:via, _, {registry_name, registry_key}} =
        Electric.Replication.Supervisor.name(ctx)

      {:ok, _} = Registry.register(registry_name, registry_key, nil)

      conn =
        Plug.Test.conn(:get, "/")
        |> Plug.Conn.assign(:config,
          stack_id: ctx.stack_id,
          stack_events_registry: Electric.stack_events_registry(),
          stack_ready_timeout: 100
        )

      conn = Electric.Plug.Utils.hold_conn_until_stack_ready(conn, [])
      refute conn.halted
    end

    test "returns 503 when stack is not ready", ctx do
      conn =
        Plug.Test.conn(:get, "/")
        |> Plug.Conn.assign(:config,
          stack_id: ctx.stack_id,
          stack_events_registry: Electric.stack_events_registry(),
          stack_ready_timeout: 100
        )

      conn = Electric.Plug.Utils.hold_conn_until_stack_ready(conn, [])
      assert conn.status == 503
      assert conn.halted
    end

    test "should release connection after stack ready", ctx do
      conn_task =
        Task.async(fn ->
          Plug.Test.conn(:get, "/")
          |> Plug.Conn.assign(:config,
            stack_id: ctx.stack_id,
            stack_events_registry: Electric.stack_events_registry(),
            stack_ready_timeout: 1000
          )
          |> Electric.Plug.Utils.hold_conn_until_stack_ready([])
        end)

      Process.sleep(100)

      Electric.StackSupervisor.dispatch_stack_event(ctx.stack_id, :ready)

      conn = Task.await(conn_task)
      refute conn.halted
    end
  end
end
