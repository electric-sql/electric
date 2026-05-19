defmodule Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitorTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Filter.Indexes.SubqueryIndex.ProgressMonitor

  setup do
    stack_id = "stack-#{System.unique_integer([:positive])}"
    start_supervised!({ProgressMonitor, stack_id: stack_id})
    %{stack_id: stack_id}
  end

  describe "register_consumer/5" do
    test "sets the min required time to the consumer's initial time", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 3)
      assert ProgressMonitor.min_required_time(stack_id, :s7) == 3
    end

    test "a second, earlier consumer lowers the min", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 5)
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_b, self(), 2)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 2
    end

    test "isolates min by subquery", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 1)
      :ok = ProgressMonitor.register_consumer(stack_id, :s8, :shape_a, self(), 4)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 1
      assert ProgressMonitor.min_required_time(stack_id, :s8) == 4
    end

    test "re-registering replaces the previous entry", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 1)
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 4)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 4
    end

    test "marks the consumer as registered", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      assert ProgressMonitor.registered?(stack_id, :s7, :shape_a)
      refute ProgressMonitor.registered?(stack_id, :s7, :shape_b)
    end
  end

  describe "notify_processed_up_to/4" do
    test "advances the min when the limiting consumer moves on", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      :ok = ProgressMonitor.notify_processed_up_to(stack_id, 0, :s7, :shape_a)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 1
    end

    test "does not advance the min when a slower consumer pins an older time", %{
      stack_id: stack_id
    } do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_b, self(), 0)

      :ok = ProgressMonitor.notify_processed_up_to(stack_id, 0, :s7, :shape_a)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 0
    end

    test "is monotonic — an earlier time does not regress the required time", %{
      stack_id: stack_id
    } do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      :ok = ProgressMonitor.notify_processed_up_to(stack_id, 5, :s7, :shape_a)
      :ok = ProgressMonitor.notify_processed_up_to(stack_id, 2, :s7, :shape_a)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 6
    end

    test "is a no-op for an unknown consumer (race-safe)", %{stack_id: stack_id} do
      assert :ok = ProgressMonitor.notify_processed_up_to(stack_id, 0, :s7, :shape_a)
      assert ProgressMonitor.min_required_time(stack_id, :s7) == nil
    end
  end

  describe "unregister_consumer/3" do
    test "releases the pinned time", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_b, self(), 5)

      :ok = ProgressMonitor.unregister_consumer(stack_id, :s7, :shape_a)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == 5
      refute ProgressMonitor.registered?(stack_id, :s7, :shape_a)
    end

    test "is idempotent", %{stack_id: stack_id} do
      :ok = ProgressMonitor.unregister_consumer(stack_id, :s7, :shape_a)
      assert ProgressMonitor.min_required_time(stack_id, :s7) == nil
    end

    test "clears the min when the last consumer unregisters", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 0)
      :ok = ProgressMonitor.unregister_consumer(stack_id, :s7, :shape_a)

      assert ProgressMonitor.min_required_time(stack_id, :s7) == nil
    end
  end

  describe "consumer process death" do
    test "automatically releases the pinned time when the consumer pid dies", %{
      stack_id: stack_id
    } do
      {pid, ref} = spawn_consumer()
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, pid, 0)
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_b, self(), 5)

      stop_consumer(pid, ref)

      assert eventually(fn ->
               ProgressMonitor.min_required_time(stack_id, :s7) == 5
             end)

      refute ProgressMonitor.registered?(stack_id, :s7, :shape_a)
    end

    test "releases every registration for that pid", %{stack_id: stack_id} do
      {pid, ref} = spawn_consumer()
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, pid, 0)
      :ok = ProgressMonitor.register_consumer(stack_id, :s8, :shape_a, pid, 0)

      stop_consumer(pid, ref)

      assert eventually(fn ->
               not ProgressMonitor.registered?(stack_id, :s7, :shape_a) and
                 not ProgressMonitor.registered?(stack_id, :s8, :shape_a)
             end)
    end
  end

  describe "for_stack/1" do
    test "returns the ETS table name for a started stack", %{stack_id: stack_id} do
      assert ProgressMonitor.for_stack(stack_id) != nil
    end

    test "returns nil when no monitor exists for the stack" do
      assert ProgressMonitor.for_stack("nope-#{System.unique_integer([:positive])}") == nil
    end
  end

  describe "min_required_time/2" do
    test "returns nil when no consumers are registered", %{stack_id: stack_id} do
      assert ProgressMonitor.min_required_time(stack_id, :s7) == nil
    end

    test "can be read by table name", %{stack_id: stack_id} do
      :ok = ProgressMonitor.register_consumer(stack_id, :s7, :shape_a, self(), 2)

      table = ProgressMonitor.for_stack(stack_id)
      assert ProgressMonitor.min_required_time(table, :s7) == 2
    end
  end

  defp spawn_consumer do
    parent = self()

    pid =
      spawn(fn ->
        ref = make_ref()
        send(parent, {:consumer_ready, ref, self()})

        receive do
          {:stop, ^ref} -> :ok
        end
      end)

    receive do
      {:consumer_ready, ref, ^pid} -> {pid, ref}
    end
  end

  defp stop_consumer(pid, ref) do
    mon = Process.monitor(pid)
    send(pid, {:stop, ref})

    receive do
      {:DOWN, ^mon, :process, ^pid, _} -> :ok
    end
  end

  defp eventually(fun, attempts \\ 50, sleep_ms \\ 5) do
    if fun.() do
      true
    else
      if attempts <= 0 do
        false
      else
        Process.sleep(sleep_ms)
        eventually(fun, attempts - 1, sleep_ms)
      end
    end
  end
end
