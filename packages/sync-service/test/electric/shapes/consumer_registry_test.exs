defmodule Electric.Shapes.ConsumerRegistryTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.ConsumerRegistry

  import Support.ComponentSetup

  require Electric.Shapes.ConsumerRegistry

  defmodule TestSubscriber do
    use GenServer

    def start_link({stack_id, handle, on_message}) do
      start_link(stack_id, handle, on_message)
    end

    def start_link(on_message) when is_function(on_message) do
      GenServer.start_link(__MODULE__, on_message)
    end

    def start_link(stack_id, handle, on_message) do
      GenServer.start_link(__MODULE__, on_message, name: ConsumerRegistry.name(stack_id, handle))
    end

    def init(on_message) do
      {:ok, on_message}
    end

    def handle_call(message, _from, on_message) do
      on_message.(message, on_message)
    end
  end

  setup :with_stack_id_from_test

  setup(ctx) do
    %{stack_id: stack_id} = ctx
    parent = self()

    {:ok, registry_state} = ConsumerRegistry.new(stack_id)

    Repatch.patch(
      Electric.ShapeCache,
      :start_consumer_for_handle,
      fn handle, ^stack_id, _opts ->
        send(parent, {:start_consumer, handle})

        {:ok, pid} =
          TestSubscriber.start_link(stack_id, handle, fn message, state ->
            send(parent, {:broadcast, handle, message})
            {:reply, :ok, state}
          end)

        {:ok, pid}
      end
    )

    [registry_state: registry_state]
  end

  describe "publish/2" do
    test "starts consumer when receiving a message", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      assert %{} ==
               ConsumerRegistry.publish(%{"handle-1" => {:txn, %{lsn: 1}}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
    end

    test "uses existing consumer when already active", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      assert %{} ==
               ConsumerRegistry.publish(%{"handle-1" => {:txn, %{lsn: 1}}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      assert %{} ==
               ConsumerRegistry.publish(%{"handle-1" => {:txn, %{lsn: 2}}}, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 2}}}
      refute_receive {:start_consumer, "handle-1"}, 10
    end

    test "starts any missing consumers", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      assert %{} ==
               ConsumerRegistry.publish(%{"handle-1" => {:txn, %{lsn: 1}}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      assert %{} ==
               ConsumerRegistry.publish(
                 %{"handle-1" => {:txn, %{lsn: 2}}, "handle-2" => {:txn, %{lsn: 2}}},
                 ctx.registry_state
               )

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 2

      assert_receive {:start_consumer, "handle-2"}, 10
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 2}}}
      assert_receive {:broadcast, "handle-2", {:txn, %{lsn: 2}}}
    end

    test "retries any consumers that suspend", ctx do
      %{stack_id: stack_id} = ctx
      parent = self()

      on_message_suspend = fn handle ->
        callback =
          fn _msg, state ->
            # we must deregister - normally handled by ShapeCleaner.handle_writer_termination/3
            ConsumerRegistry.remove_consumer(handle, stack_id)

            {:stop, Electric.ShapeCache.ShapeCleaner.consumer_suspend_reason(), state}
          end

        {stack_id, handle, callback}
      end

      on_message =
        fn handle ->
          callback =
            fn msg, state ->
              send(parent, {:broadcast, handle, msg})

              {:reply, :ok, state}
            end

          {stack_id, handle, callback}
        end

      {:ok, _sub1} =
        start_supervised(
          {TestSubscriber, on_message_suspend.("handle-1")},
          id: :subscriber1,
          restart: :transient
        )

      {:ok, _sub2} =
        start_supervised(
          {TestSubscriber, on_message_suspend.("handle-2")},
          id: :subscriber2,
          restart: :transient
        )

      {:ok, _sub3} = start_supervised({TestSubscriber, on_message.("handle-3")}, id: :subscriber3)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 3

      assert %{} ==
               ConsumerRegistry.publish(
                 %{
                   "handle-1" => {:txn, %{lsn: 1}},
                   "handle-2" => {:txn, %{lsn: 1}},
                   "handle-3" => {:txn, %{lsn: 1}}
                 },
                 ctx.registry_state
               )

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:start_consumer, "handle-2"}, 10

      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert_receive {:broadcast, "handle-2", {:txn, %{lsn: 1}}}
      assert_receive {:broadcast, "handle-3", {:txn, %{lsn: 1}}}
    end
  end

  describe "publish/2 crashed consumer handling" do
    test "dead PID in ETS is detected as crashed and returned as undeliverable", ctx do
      %{registry_state: %{table: table}} = ctx

      # Manually insert a dead PID into the ETS table to simulate a crashed consumer
      # whose entry wasn't cleaned up
      {dead_pid, ref} = spawn_monitor(fn -> :ok end)
      assert_receive {:DOWN, ^ref, :process, ^dead_pid, :normal}

      :ets.insert(table, {"handle-crash", dead_pid})
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      # Crashed consumers are NOT retried — they are returned as undeliverable
      result =
        ConsumerRegistry.publish(
          %{"handle-crash" => {:txn, %{lsn: 1}}},
          ctx.registry_state
        )

      assert :noproc == Map.fetch!(result, "handle-crash")

      # No replacement consumer should have been started
      refute_receive {:start_consumer, "handle-crash"}
    end

    test "returns undeliverable handles when shape was removed", ctx do
      %{stack_id: stack_id, registry_state: %{table: table}} = ctx
      parent = self()

      # Manually insert a dead PID to simulate a crashed consumer
      {dead_pid, ref} = spawn_monitor(fn -> :ok end)
      assert_receive {:DOWN, ^ref, :process, ^dead_pid, :normal}

      :ets.insert(table, {"handle-removed", dead_pid})
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      # Patch start_consumer_for_handle to return {:error, :no_shape} for the
      # removed handle (simulating shape removal after consumer death)
      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        [force: true],
        fn
          "handle-removed", ^stack_id, _opts ->
            {:error, :no_shape}

          handle, ^stack_id, _opts ->
            send(parent, {:start_consumer, handle})

            {:ok, pid} =
              TestSubscriber.start_link(stack_id, handle, fn message, state ->
                send(parent, {:broadcast, handle, message})
                {:reply, :ok, state}
              end)

            {:ok, pid}
        end
      )

      # Dead PID is detected as crashed, returned as undeliverable
      result =
        ConsumerRegistry.publish(
          %{"handle-removed" => {:txn, %{lsn: 1}}},
          ctx.registry_state
        )

      assert :noproc == Map.fetch!(result, "handle-removed")
    end

    test "consumer that crashes during event processing is returned as undeliverable", ctx do
      %{stack_id: stack_id} = ctx
      parent = self()

      # Start a consumer that will crash when it receives a message
      {:ok, _crash_sub} =
        start_supervised(
          {TestSubscriber,
           {stack_id, "handle-crash",
            fn _msg, _state ->
              exit(:processing_error)
            end}},
          id: :crash_subscriber,
          restart: :temporary
        )

      # Start a healthy consumer
      {:ok, _healthy_sub} =
        start_supervised(
          {TestSubscriber,
           {stack_id, "handle-ok",
            fn msg, state ->
              send(parent, {:broadcast, "handle-ok", msg})
              {:reply, :ok, state}
            end}},
          id: :healthy_subscriber
        )

      result =
        ConsumerRegistry.publish(
          %{
            "handle-crash" => {:txn, %{lsn: 1}},
            "handle-ok" => {:txn, %{lsn: 1}}
          },
          ctx.registry_state
        )

      assert_receive {:broadcast, "handle-ok", {:txn, %{lsn: 1}}}

      # Crashed handle is undeliverable with the crash reason
      assert :processing_error == Map.fetch!(result, "handle-crash")
      # Healthy handle delivered successfully
      refute Map.has_key?(result, "handle-ok")
    end

    test "suspended consumers are retried but crashed consumers are not", ctx do
      %{stack_id: stack_id} = ctx
      parent = self()

      # A consumer that suspends on first call, then succeeds on retry
      on_message_suspend = fn handle ->
        {stack_id, handle,
         fn _msg, state ->
           ConsumerRegistry.remove_consumer(handle, stack_id)
           {:stop, Electric.ShapeCache.ShapeCleaner.consumer_suspend_reason(), state}
         end}
      end

      {:ok, _sub_suspend} =
        start_supervised(
          {TestSubscriber, on_message_suspend.("handle-suspend")},
          id: :suspend_subscriber,
          restart: :transient
        )

      {:ok, _sub_crash} =
        start_supervised(
          {TestSubscriber,
           {stack_id, "handle-crash",
            fn _msg, _state ->
              exit(:boom)
            end}},
          id: :crash_subscriber,
          restart: :temporary
        )

      {:ok, _sub_ok} =
        start_supervised(
          {TestSubscriber,
           {stack_id, "handle-ok",
            fn msg, state ->
              send(parent, {:broadcast, "handle-ok", msg})
              {:reply, :ok, state}
            end}},
          id: :ok_subscriber
        )

      result =
        ConsumerRegistry.publish(
          %{
            "handle-suspend" => {:txn, %{lsn: 1}},
            "handle-crash" => {:txn, %{lsn: 1}},
            "handle-ok" => {:txn, %{lsn: 1}}
          },
          ctx.registry_state
        )

      assert_receive {:broadcast, "handle-ok", {:txn, %{lsn: 1}}}

      # Suspended handle was retried (start_consumer called for replacement)
      assert_receive {:start_consumer, "handle-suspend"}
      assert_receive {:broadcast, "handle-suspend", {:txn, %{lsn: 1}}}

      # Crashed handle is undeliverable — NOT retried
      assert :boom == Map.fetch!(result, "handle-crash")
      refute_receive {:start_consumer, "handle-crash"}

      # Healthy and retried-suspended handles delivered successfully
      refute Map.has_key?(result, "handle-ok")
      refute Map.has_key?(result, "handle-suspend")
    end

    test "persistently suspending consumer results in shape removal after retry",
         %{stack_id: stack_id} = ctx do
      test_pid = self()

      always_suspend = fn handle ->
        fn _msg, state ->
          send(test_pid, {:suspended, self()})
          ConsumerRegistry.remove_consumer(handle, stack_id)
          {:stop, Electric.ShapeCache.ShapeCleaner.consumer_suspend_reason(), state}
        end
      end

      # Patch start_consumer_for_handle to start a consumer that always suspends
      Repatch.patch(
        Electric.ShapeCache,
        :start_consumer_for_handle,
        [force: true],
        fn handle, stack_id, _opts ->
          {:ok, pid} =
            start_supervised(
              {TestSubscriber, {stack_id, handle, always_suspend.(handle)}},
              id: :stubborn_subscriber,
              restart: :temporary
            )

          send(test_pid, {:consumer_pid, pid})

          {:ok, pid}
        end
      )

      # Patch shape cleaner to avoid having to start its dependencies
      Repatch.patch(Electric.ShapeCache.ShapeCleaner, :remove_shapes, [], fn _stack_id, handles ->
        send(test_pid, {ShapeCleaner, :remove_shapes, handles})
      end)

      # First broadcast: suspended → retry broadcast: also suspended → remove shape
      result =
        ConsumerRegistry.publish(%{"handle-stubborn" => {:txn, %{lsn: 1}}}, ctx.registry_state)

      assert_receive {ShapeCleaner, :remove_shapes, ["handle-stubborn"]}

      assert %{"handle-stubborn" => {:publish, :shape_removed}} == result

      # A new consumer has been started and suspended twice during the test
      assert_receive {:consumer_pid, pid}
      assert_receive {:suspended, ^pid}
      assert_receive {:consumer_pid, pid}
      assert_receive {:suspended, ^pid}
    end
  end

  describe "register_consumer/3" do
    test "adds consumer to table under given handle", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, pid} =
        TestSubscriber.start_link(fn message, state ->
          send(parent, {:broadcast, handle, message})
          {:reply, :ok, state}
        end)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      :ok = ConsumerRegistry.register_consumer(pid, handle, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      assert %{} == ConsumerRegistry.publish(%{handle => {:txn, %{lsn: 1}}}, ctx.registry_state)
      assert_receive {:broadcast, ^handle, {:txn, %{lsn: 1}}}
      refute_receive {:start_consumer, ^handle}, 10
    end
  end

  describe "whereis/2" do
    test "returns the registered pid for named processes", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, pid} =
        TestSubscriber.start_link(ctx.stack_id, handle, fn message, state ->
          send(parent, {:broadcast, handle, message})
          {:reply, :ok, state}
        end)

      assert pid == ConsumerRegistry.whereis(ctx.stack_id, handle)
    end
  end

  describe "remove_consumer/3" do
    test "removes the process from the table", ctx do
      handle = "handle-1"
      parent = self()

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      {:ok, _pid} =
        TestSubscriber.start_link(ctx.stack_id, handle, fn message, state ->
          send(parent, {:broadcast, handle, message})
          {:reply, :ok, state}
        end)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      assert %{} == ConsumerRegistry.publish(%{handle => {:txn, %{lsn: 1}}}, ctx.registry_state)
      assert_receive {:broadcast, ^handle, {:txn, %{lsn: 1}}}
      refute_receive {:start_consumer, ^handle}, 10

      :ok = ConsumerRegistry.remove_consumer(handle, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      assert %{} ==
               ConsumerRegistry.publish(%{"handle-1" => {:txn, %{lsn: 1}}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
    end

    test "never drops the consumer count below 0", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, _pid} =
        TestSubscriber.start_link(ctx.stack_id, handle, fn message, state ->
          send(parent, {:broadcast, handle, message})
          {:reply, :ok, state}
        end)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
      :ok = ConsumerRegistry.remove_consumer(handle, ctx.registry_state)
      :ok = ConsumerRegistry.remove_consumer(handle, ctx.registry_state)
      :ok = ConsumerRegistry.remove_consumer(handle, ctx.registry_state)
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0
    end
  end

  describe "broadcast/1" do
    test "sends message to all subscribers" do
      pid = self()

      {:ok, sub1} =
        TestSubscriber.start_link(fn message, state ->
          send(pid, {:sub1, message})

          {:reply, :ok, state}
        end)

      {:ok, sub2} =
        TestSubscriber.start_link(fn message, state ->
          send(pid, {:sub2, message})
          {:reply, :ok, state}
        end)

      assert {%{}, %{}} =
               ConsumerRegistry.broadcast([
                 {"handle-1", :test_message_1, sub1},
                 {"handle-2", :test_message_2, sub2}
               ])

      assert_receive {:sub1, :test_message_1}
      assert_receive {:sub2, :test_message_2}
    end

    test "does not return until all subscibers have processed the message" do
      pid = self()

      on_message = fn :test_message, state ->
        send(pid, :message_received)

        receive do
          :finish_processing_message -> {:reply, :ok, state}
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_message)
      {:ok, sub2} = TestSubscriber.start_link(on_message)

      Task.async(fn ->
        assert {%{}, %{}} =
                 ConsumerRegistry.broadcast([
                   {"h-1", :test_message, sub1},
                   {"h-2", :test_message, sub2}
                 ])

        send(pid, :publish_finished)
      end)

      assert_receive :message_received
      assert_receive :message_received

      refute_receive :publish_finished, 10
      send(sub2, :finish_processing_message)
      refute_receive :publish_finished, 10
      send(sub1, :finish_processing_message)
      assert_receive :publish_finished
    end

    test "does not return until all subscibers have processed the message or died" do
      pid = self()

      on_message = fn :test_message, state ->
        send(pid, :message_received)

        receive do
          :finish_processing_message -> {:reply, :ok, state}
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_message)
      {:ok, sub2} = TestSubscriber.start_link(on_message)

      pid = self()

      Task.async(fn ->
        {_suspended, crashed} =
          ConsumerRegistry.broadcast([
            {"h-1", :test_message, sub1},
            {"h-2", :test_message, sub2}
          ])

        # sub2 was killed, so it appears in crashed
        assert Map.has_key?(crashed, "h-2")

        send(pid, :publish_finished)
      end)

      assert_receive :message_received
      assert_receive :message_received

      refute_receive :publish_finished, 10
      Process.unlink(sub2)
      Process.exit(sub2, :kill)
      refute_receive :publish_finished, 10
      send(sub1, :finish_processing_message)
      assert_receive :publish_finished
    end

    test "returns all handles who's consumers have suspended" do
      pid = self()

      on_message_suspend = fn :test_message, state ->
        send(pid, :message_received)

        {:stop, Electric.ShapeCache.ShapeCleaner.consumer_suspend_reason(), state}
      end

      on_message = fn :test_message, state ->
        send(pid, :message_received)

        {:reply, :ok, state}
      end

      {:ok, sub1} = start_supervised({TestSubscriber, on_message_suspend}, id: :subscriber1)
      {:ok, sub2} = start_supervised({TestSubscriber, on_message_suspend}, id: :subscriber2)
      {:ok, sub3} = start_supervised({TestSubscriber, on_message}, id: :subscriber3)

      {suspended, crashed} =
        ConsumerRegistry.broadcast([
          {"h-1", :test_message, sub1},
          {"h-2", :test_message, sub2},
          {"h-3", :test_message, sub3}
        ])

      assert Map.keys(suspended) |> Enum.sort() == ["h-1", "h-2"]
      assert crashed == %{}

      assert_receive :message_received
      assert_receive :message_received
      assert_receive :message_received
    end

    test "filters out nil pids without crashing" do
      # Handles race condition where shape is removed but events still arrive.
      # start_consumer_for_handle returns {:error, :no_shape} -> nil pid.
      parent = self()

      {:ok, subscriber} =
        TestSubscriber.start_link(fn message, state ->
          send(parent, {:broadcast, message})
          {:reply, :ok, state}
        end)

      assert {%{}, %{}} =
               ConsumerRegistry.broadcast([
                 {"valid-shape", :event, subscriber},
                 {"removed-shape", :event, nil}
               ])

      assert_receive {:broadcast, :event}
    end

    test "returns crashed consumer handles with exit reason, not for retry" do
      parent = self()

      # A consumer that crashes on receiving a message
      {:ok, crash_sub} =
        start_supervised(
          {TestSubscriber,
           fn _message, _state ->
             exit(:boom)
           end},
          id: :crash_subscriber
        )

      # A healthy consumer
      {:ok, healthy_sub} =
        start_supervised(
          {TestSubscriber,
           fn message, state ->
             send(parent, {:healthy, message})
             {:reply, :ok, state}
           end},
          id: :healthy_subscriber
        )

      {suspended, crashed} =
        ConsumerRegistry.broadcast([
          {"crash-handle", :test_event, crash_sub},
          {"healthy-handle", :test_event, healthy_sub}
        ])

      assert_receive {:healthy, :test_event}

      # Crashed handle appears in the crashed map with exit reason, NOT in suspended
      assert Map.fetch!(crashed, "crash-handle") == :boom
      assert suspended == %{}
      # The healthy handle should NOT appear in either map
      refute Map.has_key?(crashed, "healthy-handle")
      refute Map.has_key?(suspended, "healthy-handle")
    end
  end
end
