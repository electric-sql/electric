defmodule Electric.Shapes.StatusTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.Status

  import Support.ComponentSetup

  setup [:with_stack_id_from_test]

  defp start_stack_status(%{stack_id: stack_id}) do
    parent = self()

    start_link_supervised!(
      {Status,
       stack_id: stack_id,
       on_remove: fn shape_handle, pid -> send(parent, {:remove, shape_handle, pid}) end}
    )

    :ok
  end

  describe "subscriber_count/2" do
    setup [:start_stack_status]

    test "allows double registration", %{stack_id: stack_id} = _ctx do
      assert {:ok, 1} = Status.register_subscriber(stack_id, "handle-1")
      assert {:ok, 1} = Status.register_subscriber(stack_id, "handle-1")
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
              {:ok, _c} = Status.register_subscriber(stack_id, handle)

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
      assert {:ok, 1} = Status.register_subscriber(stack_id, "handle-1")
      assert {:ok, 0} = Status.unregister_subscriber(stack_id, "handle-1")
    end
  end

  describe "wait_subscriber_termination/2" do
    setup [:start_stack_status]

    test "sends a message immediately if no subscribers active", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"
      Status.wait_subscriber_termination(stack_id, handle)
      assert_receive {Status, :subscriber_termination}, 100
    end

    test "sends a message when all subcribers have terminated", %{stack_id: stack_id} = _ctx do
      handle = "some-handle"

      {:ok, subscriber1} =
        start_supervised(
          {Task,
           fn ->
             {:ok, _c} = Status.register_subscriber(stack_id, handle)

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
             {:ok, _c} = Status.register_subscriber(stack_id, handle)

             receive do
               _ -> :ok
             end
           end},
          id: {:subscriber, 2}
        )

      Status.wait_subscriber_termination(stack_id, handle)

      send(subscriber1, :done)
      refute_receive {Status, :subscriber_termination}, 100
      send(subscriber2, :done)
      assert_receive {Status, :subscriber_termination}, 100
    end

    test "cleans up if consumer exits"
  end
end
