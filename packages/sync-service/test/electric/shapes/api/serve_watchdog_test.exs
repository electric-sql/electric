defmodule Electric.Shapes.Api.ServeWatchdogTest do
  use ExUnit.Case, async: true

  import ExUnit.CaptureLog
  import Support.ComponentSetup, only: [with_stack_id_from_test: 1]

  alias Electric.AdmissionControl
  alias Electric.Shapes.Api.ServeWatchdog

  @shape_handle "the-shape-handle"

  setup :with_stack_id_from_test

  setup ctx do
    watchdog = start_supervised!({ServeWatchdog, stack_id: ctx.stack_id})
    [watchdog: watchdog]
  end

  # Spawns a process standing in for a request handler: it runs `setup_fun`
  # (arm/disarm must be called from the process being watched), reports back,
  # then hangs like a handler blocked in a socket write.
  defp victim(setup_fun) do
    parent = self()

    pid =
      spawn(fn ->
        result = setup_fun.()
        send(parent, {:registered, result})
        Process.sleep(:infinity)
      end)

    ref = Process.monitor(pid)
    assert_receive {:registered, result}
    {pid, ref, result}
  end

  test "kills a process whose write outlives its deadline", ctx do
    watchdog = ctx.watchdog

    log =
      capture_log(fn ->
        {pid, ref, _} = victim(fn -> ServeWatchdog.arm(watchdog, @shape_handle, 30) end)

        assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 1_000
      end)

    assert log =~ "Terminating stalled shape response serve"
  end

  test "does not kill a write that is still within its deadline", ctx do
    watchdog = ctx.watchdog
    {pid, ref, _} = victim(fn -> ServeWatchdog.arm(watchdog, @shape_handle, 60_000) end)

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 200
    assert Process.alive?(pid)
  end

  test "does not kill a process whose write was disarmed", ctx do
    watchdog = ctx.watchdog

    {pid, ref, _} =
      victim(fn ->
        timer = ServeWatchdog.arm(watchdog, @shape_handle, 30)
        ServeWatchdog.disarm(timer)
      end)

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 200
    assert Process.alive?(pid)
  end

  test "a timeout that fires after the write completed is a no-op", ctx do
    # The race an asynchronous cancel cannot prevent: the timer fires and its
    # message is already in flight when the handler disarms. Delivering such
    # a stale timeout must not kill the handler — disarm clears the stamped
    # ref, which is what the watchdog checks.
    watchdog = ctx.watchdog

    {pid, ref, timer_ref} =
      victim(fn ->
        timer = ServeWatchdog.arm(watchdog, @shape_handle, 60_000)
        ServeWatchdog.disarm(timer)
        timer
      end)

    send(watchdog, {:timeout, timer_ref, {:stalled_write, pid, @shape_handle}})

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 200
    assert Process.alive?(pid)
  end

  test "a timeout for a re-armed write does not kill on the stale ref", ctx do
    # Same race, one step later: the handler has moved on to its next write
    # (new stamped ref) when a stale timeout for the previous one arrives.
    watchdog = ctx.watchdog

    {pid, ref, old_timer} =
      victim(fn ->
        timer = ServeWatchdog.arm(watchdog, @shape_handle, 30)
        ServeWatchdog.disarm(timer)
        _new_timer = ServeWatchdog.arm(watchdog, @shape_handle, 60_000)
        timer
      end)

    send(watchdog, {:timeout, old_timer, {:stalled_write, pid, @shape_handle}})

    refute_receive {:DOWN, ^ref, :process, ^pid, _reason}, 200
    assert Process.alive?(pid)
  end

  test "a timeout for a handler that died on its own is a no-op", ctx do
    watchdog = ctx.watchdog
    parent = self()

    pid =
      spawn(fn ->
        ServeWatchdog.arm(watchdog, @shape_handle, 60_000)
        send(parent, :registered)
      end)

    ref = Process.monitor(pid)
    assert_receive :registered
    assert_receive {:DOWN, ^ref, :process, ^pid, :normal}

    # Deliver a fire for the dead pid directly; the watchdog must survive.
    send(watchdog, {:timeout, make_ref(), {:stalled_write, pid, @shape_handle}})
    assert Process.alive?(watchdog)
  end

  test "releases the killed handler's admission permit exactly once", ctx do
    watchdog = ctx.watchdog
    stack_id = ctx.stack_id

    events_ref = attach_reap_handler(ctx)

    {pid, ref, _} =
      victim(fn ->
        :ok = AdmissionControl.try_acquire(stack_id, :existing, max_concurrent: 10)
        Process.put(AdmissionControl.permit_pd_key(), {stack_id, :existing})
        ServeWatchdog.arm(watchdog, @shape_handle, 30)
      end)

    assert %{existing: 1} = AdmissionControl.get_current(stack_id)

    capture_log(fn ->
      assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 1_000
      # The release happens when the watchdog observes the :killed exit.
      assert_receive {:reaped, ^events_ref, %{stack_id: ^stack_id, shape_handle: @shape_handle}},
                     1_000
    end)

    assert %{existing: 0} = AdmissionControl.get_current(stack_id)
  end

  test "a killed handler without a permit releases nothing", ctx do
    watchdog = ctx.watchdog
    stack_id = ctx.stack_id

    events_ref = attach_reap_handler(ctx)

    capture_log(fn ->
      {pid, ref, _} = victim(fn -> ServeWatchdog.arm(watchdog, @shape_handle, 30) end)

      assert_receive {:DOWN, ^ref, :process, ^pid, :killed}, 1_000
      assert_receive {:reaped, ^events_ref, _meta}, 1_000
    end)

    assert %{existing: 0, initial: 0} = AdmissionControl.get_current(stack_id)
  end

  test "resolve is nil without a running watchdog or without a stack at all", ctx do
    stop_supervised!(ServeWatchdog)
    assert ServeWatchdog.resolve(ctx.stack_id) == nil
    assert ServeWatchdog.resolve(ctx.stack_id <> "-no-such-stack") == nil
  end

  defp attach_reap_handler(ctx) do
    events_ref = make_ref()
    parent = self()
    handler_id = {ctx.stack_id, :reap_test}

    :telemetry.attach(
      handler_id,
      [:electric, :plug, :serve_shape, :reaped],
      fn _event, _measurements, meta, _config -> send(parent, {:reaped, events_ref, meta}) end,
      nil
    )

    on_exit(fn -> :telemetry.detach(handler_id) end)
    events_ref
  end
end
