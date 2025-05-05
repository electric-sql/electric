defmodule Electric.Shapes.MonitorTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Monitor

  import Support.ComponentSetup

  setup [:with_stack_id_from_test, :with_in_memory_storage]

  defp start_stack_status(%{stack_id: stack_id, storage: storage}) do
    parent = self()

    start_link_supervised!(
      {Monitor,
       stack_id: stack_id,
       storage: storage,
       on_remove: fn shape_handle, pid -> send(parent, {:remove, shape_handle, pid}) end,
       on_cleanup: fn shape_handle -> send(parent, {:on_cleanup, shape_handle}) end}
    )

    :ok
  end

  describe "reader_count/2" do
    setup [:start_stack_status]

    test "allows double registration", %{stack_id: stack_id} = _ctx do
      assert :ok = Monitor.register_reader(stack_id, "handle-1")
      assert :ok = Monitor.register_reader(stack_id, "handle-1")

      assert {:ok, 1} = Monitor.reader_count(stack_id, "handle-1")
    end

    test "tracks process termination", %{stack_id: stack_id} = _ctx do
      parent = self()
      n = Enum.random(1..200)

      handles =
        Enum.map(1..Enum.random(1..20), &"handle-#{String.pad_leading(to_string(&1), 3, "0")}")

      random_handle_stream = Stream.repeatedly(fn -> Enum.random(handles) end)

      pids =
        for handle <- Enum.take(random_handle_stream, n) do
          {:ok, pid} =
            Task.start_link(fn ->
              :ok = Monitor.register_reader(stack_id, handle)

              send(parent, {:ready, self()})

              receive do
                _ -> :ok
              end
            end)

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
      Monitor.notify_reader_termination(stack_id, handle, {:shutdown, :bored})
      assert_receive {Monitor, :reader_termination, ^handle, {:shutdown, :bored}}, 100
    end

    test "sends a message when all subcribers have terminated", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      parent = self()

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

    test "cleans up if consumer exits", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      parent = self()

      {:ok, consumer} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_writer(stack_id, handle)

             send(parent, {:ready, :consumer, 1})

             receive do
               :wait_subscriber ->
                 :ok = Monitor.notify_reader_termination(stack_id, handle, :normal)
                 send(parent, {:ready, :consumer, 2})

                 receive do
                   _ -> raise "bye"
                 end
             end
           end},
          id: {:consumer, 1}
        )

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

      send(consumer, :bye)

      assert_receive {:DOWN, _, :process, ^consumer, _}

      assert {:ok, []} = Monitor.termination_watchers(stack_id, handle)
    end

    test "is triggered if same reader pid changes shape handle", %{stack_id: stack_id} = _ctx do
      handle1 = "some-handle-1"
      handle2 = "some-handle-2"
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
      send(subscriber1, {:subscribe, handle2})
      assert_receive {Monitor, :reader_termination, ^handle1, :my_reason}, 100
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

  defp wrap_storage(%{storage: storage}) do
    storage = Support.TestStorage.wrap(storage, %{})
    [storage: storage]
  end

  describe "cleanup_after_termination/2" do
    setup [:wrap_storage, :start_stack_status]

    test "cleanup is performed if the consumer registers", %{stack_id: stack_id} do
      handle = "some-handle-1"
      parent = self()

      {:ok, supervisor} =
        start_supervised(
          {Task,
           fn ->
             receive do
               _ -> :ok
             end
           end},
          id: {:supervisor, 1}
        )

      {:ok, consumer} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_writer(stack_id, handle)
             send(parent, {:ready, 1})

             receive do
               :request_cleanup ->
                 :ok = Monitor.cleanup_after_termination(stack_id, handle, supervisor)
                 send(parent, {:cleanup, 1})

                 receive do
                   _ ->
                     :ok
                 end
             end
           end},
          id: {:consumer, 1}
        )

      assert_receive {:ready, 1}

      send(consumer, :request_cleanup)
      assert_receive {:cleanup, 1}
      send(consumer, :quit)
      refute_receive {Support.TestStorage, :unsafe_cleanup!, ^handle}
      send(supervisor, :quit)
      assert_receive {Support.TestStorage, :unsafe_cleanup!, ^handle}
      assert_receive {:on_cleanup, ^handle}
    end

    test "cleanup is not performed unless the consumer registers", %{stack_id: stack_id} do
      handle = "some-handle-1"
      parent = self()

      {:ok, consumer} =
        start_supervised(
          {Task,
           fn ->
             :ok = Monitor.register_writer(stack_id, handle)
             send(parent, {:ready, 1})

             receive do
               :quit ->
                 :ok
             end
           end},
          id: {:consumer, 1}
        )

      assert_receive {:ready, 1}

      send(consumer, :quit)
      refute_receive {Support.TestStorage, :unsafe_cleanup!, ^handle}
    end

    test "returns an error if the process is not registered as a consumer", %{stack_id: stack_id} do
      assert {:error, _} = Monitor.cleanup_after_termination(stack_id, "some-handle-1", self())
    end
  end
end
