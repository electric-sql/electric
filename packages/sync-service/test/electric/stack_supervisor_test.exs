defmodule Electric.StackSupervisorTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.AdmissionControl
  alias Electric.StackSupervisor

  import Support.ComponentSetup

  describe "Telemetry" do
    setup [:with_stack_id_from_test]

    test "count_shapes/2 emits split shape metrics", ctx do
      stack_id = ctx.stack_id

      Repatch.patch(Electric.ShapeCache, :shape_counts, fn _stack_id ->
        %{total: 7, indexed: 4, unindexed: 3}
      end)

      Repatch.patch(Electric.Shapes.ConsumerRegistry, :active_consumer_count, fn _stack_id ->
        2
      end)

      handler_id = {__MODULE__, make_ref()}

      :telemetry.attach_many(
        handler_id,
        [
          [:electric, :shapes, :total_shapes],
          [:electric, :shapes, :active_shapes]
        ],
        fn event_name, measurements, metadata, pid ->
          send(pid, {event_name, measurements, metadata})
        end,
        self()
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)

      StackSupervisor.Telemetry.count_shapes(stack_id, %{})

      assert_receive {[:electric, :shapes, :total_shapes],
                      %{count: 7, count_indexed: 4, count_unindexed: 3}, %{stack_id: ^stack_id}}

      assert_receive {[:electric, :shapes, :active_shapes], %{count: 2}, %{stack_id: ^stack_id}}
    end

    test "report_admission_control/3 reports the permits in flight and their limits", ctx do
      stack_id = ctx.stack_id
      limits = %{initial: 300, existing: 10}

      assert {StackSupervisor.Telemetry, :report_admission_control, [stack_id, limits]} in
               StackSupervisor.Telemetry.default_periodic_measurements(%{
                 stack_id: stack_id,
                 max_concurrent_requests: limits,
                 replication_opts: []
               })

      for _ <- 1..3 do
        :ok = AdmissionControl.try_acquire(stack_id, :existing, max_concurrent: 10)
      end

      :ok = AdmissionControl.release(stack_id, :existing)

      handler_id = {__MODULE__, make_ref()}

      :telemetry.attach(
        handler_id,
        [:electric, :admission_control, :acquire],
        fn _event_name, measurements, metadata, pid ->
          send(pid, {:acquire, measurements, metadata})
        end,
        self()
      )

      on_exit(fn -> :telemetry.detach(handler_id) end)

      StackSupervisor.Telemetry.report_admission_control(stack_id, limits, %{})

      assert_received {:acquire, %{current: 2, limit: 10},
                       %{stack_id: ^stack_id, kind: :existing}}

      assert_received {:acquire, %{current: 0, limit: 300},
                       %{stack_id: ^stack_id, kind: :initial}}
    end
  end
end
