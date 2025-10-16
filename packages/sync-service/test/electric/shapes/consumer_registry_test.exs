defmodule Electric.Shapes.ConsumerRegistryTest do
  use ExUnit.Case, async: true

  alias Electric.Shapes.ConsumerRegistry

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
