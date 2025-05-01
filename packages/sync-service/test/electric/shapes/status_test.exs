defmodule Electric.Shapes.StatusTest do
  use ExUnit.Case, async: true

  alias File.Stat
  alias Electric.Shapes.Status

  import Support.ComponentSetup

  setup [:with_stack_id_from_test, :with_in_memory_storage]

  defp start_stack_status(%{stack_id: stack_id, storage: storage}) do
    parent = self()

    start_link_supervised!(
      {Status,
       stack_id: stack_id,
       storage: storage,
       on_remove: fn shape_handle, pid -> send(parent, {:remove, shape_handle, pid}) end}
    )

    :ok
  end

  describe "subscriber_count/2" do
    setup [:start_stack_status]

    test "allows double registration", %{stack_id: stack_id} = _ctx do
      assert :ok = Status.register_subscriber(stack_id, "handle-1")
      assert :ok = Status.register_subscriber(stack_id, "handle-1")

      assert {:ok, 1} = Status.subscriber_count(stack_id, "handle-1")
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
              :ok = Status.register_subscriber(stack_id, handle)

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
        assert {:ok, count} == Status.subscriber_count(stack_id, handle)
      end

      pids
      |> Enum.shuffle()
      |> Enum.reduce(counts, fn {handle, pid}, counts ->
        {n, counts} = Map.get_and_update(counts, handle, &{&1, &1 - 1})

        assert {:ok, ^n} = Status.subscriber_count(stack_id, handle)

        send(pid, :stop)

        assert_receive {:remove, ^handle, ^pid}

        assert {:ok, n - 1} == Status.subscriber_count(stack_id, handle)

        counts
      end)
    end

    test "allows for manual deregistration", %{stack_id: stack_id} = _ctx do
      assert :ok = Status.register_subscriber(stack_id, "handle-1")
      assert :ok = Status.unregister_subscriber(stack_id, "handle-1")
      assert {:ok, 0} = Status.subscriber_count(stack_id, "handle-1")
    end
  end

  describe "wait_subscriber_termination/2" do
    setup [:start_stack_status]

    test "sends a message immediately if no subscribers active", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      Status.wait_subscriber_termination(stack_id, handle)
      assert_receive {Status, :subscriber_termination, ^handle}, 100
    end

    test "sends a message when all subcribers have terminated", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      parent = self()

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Status.register_subscriber(stack_id, handle)
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
             :ok = Status.register_subscriber(stack_id, handle)
             send(parent, {:ready, 2})

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 2}
        )

      assert_receive {:ready, 1}
      assert_receive {:ready, 2}

      Status.wait_subscriber_termination(stack_id, handle)

      send(subscriber1, :done)
      refute_receive {Status, :subscriber_termination, _handle}, 100
      send(subscriber2, :done)
      assert_receive {Status, :subscriber_termination, ^handle}, 100
    end

    test "cleans up if consumer exits"

    test "is triggered if same reader pid changes shape handle", %{stack_id: stack_id} = _ctx do
      handle1 = "some-handle-1"
      handle2 = "some-handle-2"
      parent = self()

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Status.register_subscriber(stack_id, handle1)

             send(parent, :ready)

             receive do
               {:subscribe, handle} ->
                 :ok = Status.register_subscriber(stack_id, handle)

                 receive do
                   _ ->
                     dbg(:done)
                     :ok
                 end
             end
           end},
          id: {:subscriber, 1}
        )

      assert_receive :ready, 100
      Status.wait_subscriber_termination(stack_id, handle1)
      send(subscriber1, {:subscribe, handle2})
      assert_receive {Status, :subscriber_termination, ^handle1}, 100
    end

    test "is not triggered if same reader pid re-registers under same handle",
         %{stack_id: stack_id} = _ctx do
      handle1 = "some-handle-1"
      parent = self()

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             :ok = Status.register_subscriber(stack_id, handle1)

             send(parent, :ready)

             receive do
               {:subscribe, handle} ->
                 :ok = Status.register_subscriber(stack_id, handle)

                 receive do
                   _ ->
                     dbg(:done)
                     :ok
                 end
             end
           end},
          id: {:subscriber, 1}
        )

      assert_receive :ready, 100
      Status.wait_subscriber_termination(stack_id, handle1)
      send(subscriber1, {:subscribe, handle1})
      refute_receive {Status, :subscriber_termination, _handle1}, 100
    end
  end
end
