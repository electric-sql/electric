defmodule Electric.Plug.UtilsTest do
  alias Electric.Plug.Utils
  import Support.ComponentSetup
  use ExUnit.Case, async: true
  doctest Utils, import: true

  describe "get_next_interval_timestamp/2" do
    test "returns expected interval" do
      long_poll_timeout_ms = 20000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)
      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns the expected value
      assert Utils.get_next_interval_timestamp(long_poll_timeout_ms) ==
               expected_interval
    end

    test "returns expected inteval with different timeout" do
      long_poll_timeout_ms = 30000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns the expected value
      assert Utils.get_next_interval_timestamp(long_poll_timeout_ms) ==
               expected_interval
    end

    test "returns expected interval with different timeout and cursor collision" do
      long_poll_timeout_ms = 30000
      long_poll_timeout_sec = div(long_poll_timeout_ms, 1000)

      # Calculate the expected next interval
      now = DateTime.utc_now()
      oct9th2024 = DateTime.from_naive!(~N[2024-10-09 00:00:00], "Etc/UTC")
      diff_in_seconds = DateTime.diff(now, oct9th2024, :second)
      expected_interval = ceil(diff_in_seconds / long_poll_timeout_sec) * long_poll_timeout_sec

      # Assert that the function returns a DIFFERENT value due to collision
      assert Utils.get_next_interval_timestamp(
               long_poll_timeout_ms,
               "#{expected_interval}"
             ) != expected_interval
    end
  end

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
          stack_events_registry: Registry.StackEvents,
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
          stack_events_registry: Registry.StackEvents,
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
            stack_events_registry: Registry.StackEvents,
            stack_ready_timeout: 1000
          )
          |> Electric.Plug.Utils.hold_conn_until_stack_ready([])
        end)

      Process.sleep(50)

      Electric.StackSupervisor.dispatch_stack_event(Registry.StackEvents, ctx.stack_id, :ready)

      conn = Task.await(conn_task)
      refute conn.halted
    end
  end
end
