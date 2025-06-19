defmodule Electric.PublisherTest do
  use ExUnit.Case, async: true

  alias Electric.Publisher
  alias Electric.PublisherTest.TestSubscriber

  defmodule TestSubscriber do
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

  describe "publish/2" do
    test "sends message to all subscribers" do
      pid = self()
      {:ok, sub1} = TestSubscriber.start_link(fn message -> send(pid, {:sub1, message}) end)
      {:ok, sub2} = TestSubscriber.start_link(fn message -> send(pid, {:sub2, message}) end)

      Publisher.publish([sub1, sub2], :test_message)

      assert_receive {:sub1, :test_message}
      assert_receive {:sub2, :test_message}
    end

    test "does not return until all subscibers have processed the message" do
      on_event = fn :test_message ->
        receive do
          :finish_processing_event -> :ok
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_event)
      {:ok, sub2} = TestSubscriber.start_link(on_event)

      pid = self()

      Task.async(fn ->
        Publisher.publish([sub1, sub2], :test_message)
        send(pid, :publish_finished)
      end)

      refute_receive :publish_finished, 10
      send(sub2, :finish_processing_event)
      refute_receive :publish_finished, 10
      send(sub1, :finish_processing_event)
      assert_receive :publish_finished, 5000
    end

    test "does not return until all subscibers have processed the message or died" do
      on_event = fn :test_message ->
        receive do
          :finish_processing_event -> :ok
        end
      end

      {:ok, sub1} = TestSubscriber.start_link(on_event)
      {:ok, sub2} = TestSubscriber.start_link(on_event)

      pid = self()

      Task.async(fn ->
        Publisher.publish([sub1, sub2], :test_message)
        send(pid, :publish_finished)
      end)

      refute_receive :publish_finished, 10
      Process.unlink(sub2)
      Process.exit(sub2, :kill)
      refute_receive :publish_finished, 10
      send(sub1, :finish_processing_event)
      assert_receive :publish_finished, 5000
    end
  end
end
