defmodule Electric.Shapes.MonitorTest do
  use ExUnit.Case, async: true
  use Repatch.ExUnit

  alias Electric.ShapeCache.ShapeStatus
  alias Electric.Shapes.Monitor
  alias Electric.Shapes.Shape

  alias Support.StubInspector

  import Support.ComponentSetup

  @inspector StubInspector.new(
               tables: ["the_table"],
               columns: [%{name: "id", type: "int8", pk_position: 0}]
             )
  @shape Shape.new!("the_table", inspector: @inspector)
  @shape_handle "some-handle"

  setup [
    :with_stack_id_from_test,
    :with_in_memory_storage,
    :with_test_publication_manager,
    :with_consumer_registry
  ]

  def shape, do: @shape

  defp start_stack_status(ctx) do
    Repatch.patch(Electric.Shapes.Shape, :generate_id, fn _shape -> {"hash", @shape_handle} end)

    :ok = Electric.ShapeCache.ShapeStatus.initialize_from_storage(ctx.stack_id, ctx.storage)

    parent = self()

    start_link_supervised!({
      Monitor,
      # publication_manager: ctx.publication_manager,
      stack_id: ctx.stack_id,
      storage: ctx.storage,
      on_remove: fn shape_handle, pid -> send(parent, {:remove, shape_handle, pid}) end,
      on_cleanup: fn shape_handle -> send(parent, {:on_cleanup, shape_handle}) end
    })

    :ok
  end

  describe "reader_count/2" do
    setup [:start_stack_status]

    test "allows double registration", %{stack_id: stack_id} = _ctx do
      assert :ok = Monitor.register_reader(stack_id, "handle-1")
      assert :ok = Monitor.register_reader(stack_id, "handle-1")

      assert {:ok, 1} = Monitor.reader_count(stack_id, "handle-1")
    end

    test "allows double de-registration", %{stack_id: stack_id} = _ctx do
      assert :ok = Monitor.register_reader(stack_id, "handle-1")
      assert :ok = Monitor.register_reader(stack_id, "handle-1")

      assert {:ok, 1} = Monitor.reader_count(stack_id, "handle-1")
      assert {:ok, 1} = Monitor.reader_count(stack_id)

      assert :ok = Monitor.unregister_reader(stack_id, "handle-1")
      assert :ok = Monitor.unregister_reader(stack_id, "handle-1")
      assert :ok = Monitor.unregister_reader(stack_id, "handle-1")

      assert {:ok, 0} = Monitor.reader_count(stack_id, "handle-1")
      assert {:ok, 0} = Monitor.reader_count(stack_id)
    end

    test "tracks process termination", %{stack_id: stack_id} = _ctx do
      parent = self()
      n = Enum.random(1..200)

      handles =
        Enum.map(1..Enum.random(1..20), &"handle-#{String.pad_leading(to_string(&1), 3, "0")}")

      random_handle_stream = Stream.repeatedly(fn -> Enum.random(handles) end)

      pids =
        for handle <- Enum.take(random_handle_stream, n) do
          pid =
            start_link_supervised!(%{
              id: {:reader, System.monotonic_time(:microsecond), handle},
              start:
                {Task, :start_link,
                 [
                   fn ->
                     :ok = Monitor.register_reader(stack_id, handle)

                     send(parent, {:ready, self()})

                     receive do
                       _ -> :ok
                     end
                   end
                 ]},
              restart: :temporary
            })

          assert_receive {:ready, ^pid}

          {handle, pid}
        end

      handle_pid = Enum.group_by(pids, &elem(&1, 0), &elem(&1, 1))

      counts = Map.new(handle_pid, fn {handle, pids} -> {handle, length(pids)} end)

      for {handle, count} <- counts do
        assert {:ok, count} == Monitor.reader_count(stack_id, handle)
      end

      pids
      |> Enum.shuffle()
      |> Enum.reduce(counts, fn {handle, pid}, counts ->
        {n, counts} = Map.get_and_update(counts, handle, &{&1, &1 - 1})

        assert {:ok, ^n} = Monitor.reader_count(stack_id, handle)

        send(pid, :stop)

        assert_receive {:remove, ^handle, ^pid}

        assert {:ok, n - 1} == Monitor.reader_count(stack_id, handle)

        counts
      end)
    end

    test "allows for manual deregistration", %{stack_id: stack_id} = _ctx do
      assert :ok = Monitor.register_reader(stack_id, "handle-1")
      assert :ok = Monitor.unregister_reader(stack_id, "handle-1")
      assert {:ok, 0} = Monitor.reader_count(stack_id, "handle-1")
    end
  end

  describe "notify_reader_termination/4" do
    setup [:start_stack_status]

    test "sends a message immediately if no subscribers active", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      {:ok, _consumer_supervisor} = start_consumer(stack_id, handle)
      Monitor.notify_reader_termination(stack_id, handle, {:shutdown, :bored})
      assert_receive {Monitor, :reader_termination, ^handle, {:shutdown, :bored}}, 1000
    end

    test "sends a message when all subcribers have terminated", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      parent = self()

      {:ok, _consumer_supervisor} = start_consumer(stack_id, handle)

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_reader(stack_id, handle)
             send(parent, {:ready, 1})

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 1}
        )

      {:ok, subscriber2} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_reader(stack_id, handle)
             send(parent, {:ready, 2})

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 2}
        )

      assert_receive {:ready, 1}
      assert_receive {:ready, 2}

      Monitor.notify_reader_termination(stack_id, handle, :my_reason)

      send(subscriber1, :done)
      refute_receive {Monitor, :reader_termination, _handle, _}, 100
      send(subscriber2, :done)
      assert_receive {Monitor, :reader_termination, ^handle, :my_reason}, 100
    end

    defmodule ControlledConsumer do
      use GenServer

      def start_link({stack_id, handle, parent}) do
        GenServer.start_link(__MODULE__, {stack_id, handle, parent},
          name: :"controlled_consumer-#{stack_id}-#{handle}"
        )
      end

      @impl GenServer
      def init({stack_id, handle, parent}) do
        send(parent, {:ready, :consumer, 1})
        {:ok, {stack_id, handle, parent}}
      end

      @impl GenServer
      def handle_info(:wait_subscriber, {stack_id, handle, parent} = state) do
        :ok = Monitor.notify_reader_termination(stack_id, handle, :normal)
        send(parent, {:ready, :consumer, 2})
        {:noreply, state}
      end

      def handle_info({:raise, msg}, _state) do
        raise msg
      end

      def handle_info({:stop, reason}, state) do
        {:stop, reason, state}
      end
    end

    defp start_consumer(stack_id, handle) do
      parent = self()

      {:ok, pid} =
        start_supervised(
          {Task,
           fn ->
             Electric.Shapes.ConsumerRegistry.register_consumer(self(), handle, stack_id)

             send(parent, {:ready, :consumer})

             receive do
               _ -> :ok
             end
           end},
          id: {:consumer, {stack_id, handle}}
        )

      assert_receive {:ready, :consumer}

      {:ok, pid}
    end

    defp exit_consumer(ctx, handle, reason) do
      %{stack_id: stack_id} = ctx

      parent = self()

      {:ok, consumer} =
        start_supervised(%{
          id: ControlledConsumer,
          start: {ControlledConsumer, :start_link, [{stack_id, handle, parent}]},
          restart: :temporary
        })

      {:ok, _subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_reader(stack_id, handle)
             send(parent, {:ready, :subscriber, 1})

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 1}
        )

      {:ok, _subscriber2} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_reader(stack_id, handle)
             send(parent, {:ready, :subscriber, 2})

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 2}
        )

      Process.monitor(consumer)

      assert_receive {:ready, :consumer, 1}
      assert_receive {:ready, :subscriber, 1}
      assert_receive {:ready, :subscriber, 2}

      send(consumer, :wait_subscriber)

      assert_receive {:ready, :consumer, 2}

      assert {:ok, [{^consumer, :normal}]} = Monitor.termination_watchers(stack_id, handle)

      case reason do
        {:raise, message} ->
          send(consumer, {:raise, message})

        reason ->
          send(consumer, {:stop, reason})
      end

      assert_receive {:DOWN, _, :process, ^consumer, _}

      # we don't get reasons from the supervisor, it just `:shutdown`s

      assert {:ok, []} = Monitor.termination_watchers(stack_id, handle)
    end

    test "cleans up if consumer raises", ctx do
      assert {:ok, @shape_handle} == ShapeStatus.add_shape(ctx.stack_id, @shape)
      assert {@shape_handle, _} = ShapeStatus.get_existing_shape(ctx.stack_id, @shape_handle)

      exit_consumer(ctx, @shape_handle, {:raise, "boom"})

      assert_receive {:on_cleanup, @shape_handle}

      assert_receive {Support.ComponentSetup.TestPublicationManager, :remove_shape, @shape_handle}

      refute ShapeStatus.get_existing_shape(ctx.stack_id, @shape_handle)
    end

    test "cleans up if consumer exits with {:shutdown, :cleanup}", ctx do
      assert {:ok, @shape_handle} == ShapeStatus.add_shape(ctx.stack_id, @shape)
      assert {@shape_handle, _} = ShapeStatus.get_existing_shape(ctx.stack_id, @shape_handle)

      exit_consumer(ctx, @shape_handle, {:shutdown, :cleanup})

      assert_receive {:on_cleanup, @shape_handle}

      assert_receive {Support.ComponentSetup.TestPublicationManager, :remove_shape, @shape_handle}

      refute ShapeStatus.get_existing_shape(ctx.stack_id, @shape_handle)
    end

    test "does not clean up if consumer exits with :normal", ctx do
      handle = "some-handle"

      exit_consumer(ctx, handle, :normal)

      refute_receive {:on_cleanup, ^handle}, 500
    end

    test "is triggered if same reader pid changes shape handle", %{stack_id: stack_id} = _ctx do
      handle1 = "some-handle-1"
      handle2 = "some-handle-2"

      {:ok, _consumer1} = start_consumer(stack_id, handle1)
      {:ok, _consumer2} = start_consumer(stack_id, handle2)

      :ok = Monitor.register_reader(stack_id, handle1)

      Monitor.notify_reader_termination(stack_id, handle1, :my_reason)

      assert {:ok, 1} = Monitor.reader_count(stack_id, handle1)

      :ok = Monitor.register_reader(stack_id, handle2)

      assert {:ok, 0} = Monitor.reader_count(stack_id, handle1)
      assert {:ok, 1} = Monitor.reader_count(stack_id, handle2)

      assert_receive {Monitor, :reader_termination, ^handle1, :my_reason}, 100

      Monitor.notify_reader_termination(stack_id, handle2, :my_reason)
    end

    test "is not triggered if same reader pid re-registers under same handle",
         %{stack_id: stack_id} = _ctx do
      handle1 = "some-handle-1"
      parent = self()

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_reader(stack_id, handle1)

             send(parent, :ready)

             receive do
               {:subscribe, handle} ->
                 :ok = Monitor.register_reader(stack_id, handle)

                 receive do
                   _ ->
                     :ok
                 end
             end
           end},
          id: {:subscriber, 1}
        )

      assert_receive :ready, 100
      Monitor.notify_reader_termination(stack_id, handle1, :my_reason)
      send(subscriber1, {:subscribe, handle1})
      refute_receive {Monitor, :reader_termination, _handle1, _}, 100
    end
  end
end
