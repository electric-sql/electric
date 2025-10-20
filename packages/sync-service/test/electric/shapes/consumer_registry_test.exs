defmodule Electric.Shapes.ConsumerRegistryTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.ConsumerRegistry

  import Support.ComponentSetup

  require Electric.Shapes.ConsumerRegistry

  defmodule TestSubscriber do
    use GenServer

    def start_link(on_message) do
      GenServer.start_link(__MODULE__, on_message)
    end

    def init(on_message) do
      {:ok, on_message}
    end

    def handle_call(message, _from, on_message) do
      on_message.(message)
      {:reply, :ok, on_message}
    end
  end

  setup :with_stack_id_from_test

  setup(ctx) do
    %{stack_id: stack_id} = ctx
    parent = self()

    {:ok, registry_state} =
      ConsumerRegistry.new(
        stack_id,
        start_consumer_fun: fn handle, stack_id: ^stack_id ->
          send(parent, {:start_consumer, handle})

          {:ok, pid} =
            TestSubscriber.start_link(fn message ->
              send(parent, {:broadcast, handle, message})
            end)

          {:ok, [{handle, pid}]}
        end
      )

    [registry_state: registry_state]
  end

  describe "publish/3" do
    test "starts consumer when receiving a message", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0
      :ok = ConsumerRegistry.publish(["handle-1"], {:txn, %{lsn: 1}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
    end

    test "uses existing consumer when already active", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0
      :ok = ConsumerRegistry.publish(["handle-1"], {:txn, %{lsn: 1}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      :ok = ConsumerRegistry.publish(["handle-1"], {:txn, %{lsn: 2}}, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 2}}}
      refute_receive {:start_consumer, "handle-1"}, 10
    end

    test "starts any missing consumers", ctx do
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0
      :ok = ConsumerRegistry.publish(["handle-1"], {:txn, %{lsn: 1}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      :ok =
        ConsumerRegistry.publish(["handle-1", "handle-2"], {:txn, %{lsn: 2}}, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 2

      assert_receive {:start_consumer, "handle-2"}, 10
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 2}}}
      assert_receive {:broadcast, "handle-2", {:txn, %{lsn: 2}}}
    end
  end

  describe "register_consumer/3" do
    test "adds consumer to table under given handle", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, pid} =
        TestSubscriber.start_link(fn message ->
          send(parent, {:broadcast, handle, message})
        end)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      {:ok, 1} = ConsumerRegistry.register_consumer(handle, pid, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      :ok = ConsumerRegistry.publish([handle], {:txn, %{lsn: 1}}, ctx.registry_state)
      assert_receive {:broadcast, ^handle, {:txn, %{lsn: 1}}}
      refute_receive {:start_consumer, ^handle}, 10
    end
  end

  describe "whereis/2" do
    test "returns the registered pid", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, pid} =
        TestSubscriber.start_link(fn message ->
          send(parent, {:broadcast, handle, message})
        end)

      {:ok, 1} = ConsumerRegistry.register_consumer(handle, pid, ctx.registry_state)

      assert pid == ConsumerRegistry.whereis(ctx.stack_id, handle)
    end
  end

  describe "remove_consumer/3" do
    test "removes the process from the table", ctx do
      handle = "handle-1"
      parent = self()

      {:ok, pid} =
        TestSubscriber.start_link(fn message ->
          send(parent, {:broadcast, handle, message})
        end)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      {:ok, 1} = ConsumerRegistry.register_consumer(handle, pid, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1

      :ok = ConsumerRegistry.publish([handle], {:txn, %{lsn: 1}}, ctx.registry_state)
      assert_receive {:broadcast, ^handle, {:txn, %{lsn: 1}}}
      refute_receive {:start_consumer, ^handle}, 10

      :ok = ConsumerRegistry.remove_consumer(handle, ctx.registry_state)

      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 0

      :ok = ConsumerRegistry.publish(["handle-1"], {:txn, %{lsn: 1}}, ctx.registry_state)

      assert_receive {:start_consumer, "handle-1"}
      assert_receive {:broadcast, "handle-1", {:txn, %{lsn: 1}}}
      assert ConsumerRegistry.active_consumer_count(ctx.stack_id) == 1
    end
  end

  describe "broadcast/2" do
    test "sends message to all subscribers" do
      pid = self()

      {:ok, sub1} = TestSubscriber.start_link(fn message -> send(pid, {:sub1, message}) end)
      {:ok, sub2} = TestSubscriber.start_link(fn message -> send(pid, {:sub2, message}) end)

      ConsumerRegistry.broadcast([sub1, sub2], :test_message)

      assert_receive {:sub1, :test_message}
      assert_receive {:sub2, :test_message}
    end

    test "does not return until all subscibers have processed the message" do
      pid = self()

      on_message = fn :test_message ->
        send(pid, :message_received)

        receive do
          :finish_processing_message -> :ok
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_message)
      {:ok, sub2} = TestSubscriber.start_link(on_message)

      Task.async(fn ->
        ConsumerRegistry.broadcast([sub1, sub2], :test_message)
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

      on_message = fn :test_message ->
        send(pid, :message_received)

        receive do
          :finish_processing_message -> :ok
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_message)
      {:ok, sub2} = TestSubscriber.start_link(on_message)

      pid = self()

      Task.async(fn ->
        ConsumerRegistry.broadcast([sub1, sub2], :test_message)
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
  end
end
