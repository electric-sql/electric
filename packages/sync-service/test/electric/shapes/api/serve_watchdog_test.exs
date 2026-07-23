defmodule Electric.Shapes.Api.ServeWatchdogTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  alias Electric.Shapes.Api.ServeWatchdog

  @sweep_interval_ms 25
  @shape_handle "the-shape-handle"

  setup :with_stack_id_from_test

  defp start_watchdog(ctx) do
    start_supervised!(
      {ServeWatchdog, stack_id: ctx.stack_id, sweep_interval_ms: @sweep_interval_ms}
    )
  end

  # Spawns a process standing in for a request handler: it runs `register`
  # (calls to write_started/write_finished must come from the process being
  # watched), reports back, then hangs like a handler blocked in a socket
  # write.
  defp victim(register) do
    parent = self()

    pid =
      spawn(fn ->
        register.()
        send(parent, :registered)
        Process.sleep(:infinity)
      end)

    ref = Process.monitor(pid)
    assert_receive :registered
    {pid, ref}
  end

  test "kills a process whose write outlives its deadline", ctx do
    start_watchdog(ctx)
    stack_id = ctx.stack_id

    log =
      capture_log(fn ->
        {pid, ref} = victim(fn -> ServeWatchdog.write_started(stack_id, @shape_handle, 30) end)

        assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 1_000
      end)

    assert log =~ "Terminating stalled shape response serve"
  end

  test "does not kill a write that is still within its deadline", ctx do
    start_watchdog(ctx)
    stack_id = ctx.stack_id

    {pid, ref} = victim(fn -> ServeWatchdog.write_started(stack_id, @shape_handle, 60_000) end)

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 10 * @sweep_interval_ms
    assert Process.alive?(pid)
  end

  test "does not kill a process whose write finished", ctx do
    start_watchdog(ctx)
    stack_id = ctx.stack_id

    {pid, ref} =
      victim(fn ->
        ServeWatchdog.write_started(stack_id, @shape_handle, 30)
        ServeWatchdog.write_finished(stack_id)
      end)

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 10 * @sweep_interval_ms
    assert Process.alive?(pid)
  end

  test "a new write replaces the previous deadline", ctx do
    start_watchdog(ctx)
    stack_id = ctx.stack_id

    {pid, ref} =
      victim(fn ->
        ServeWatchdog.write_started(stack_id, @shape_handle, 30)
        ServeWatchdog.write_finished(stack_id)
        ServeWatchdog.write_started(stack_id, @shape_handle, 60_000)
      end)

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 10 * @sweep_interval_ms
    assert Process.alive?(pid)
  end

  test "prunes entries for processes that died on their own", ctx do
    start_watchdog(ctx)
    stack_id = ctx.stack_id
    parent = self()

    pid =
      spawn(fn ->
        ServeWatchdog.write_started(stack_id, @shape_handle, 60_000)
        send(parent, :registered)
      end)

    ref = Process.monitor(pid)
    assert_receive :registered
    assert_receive {:DOWN, ^ref, :process, ^pid, :normal}

    # After a sweep the entry is gone and the server is healthy.
    Process.sleep(3 * @sweep_interval_ms)
    assert %{writes: writes} = :sys.get_state(ServeWatchdog.name(stack_id))
    assert writes == %{}
  end

  test "registration without a running server is silently dropped", ctx do
    # No watchdog started for this stack: serving degrades to unguarded.
    assert :ok = ServeWatchdog.write_started(ctx.stack_id, @shape_handle, 30)
    assert :ok = ServeWatchdog.write_finished(ctx.stack_id)
  end
end
