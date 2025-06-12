defmodule Electric.PublisherTest do
  use ExUnit.Case, async: true

  alias Electric.TestPublisher
  alias Electric.TestSubscriber

  defmodule TestPublisher do
    use Electric.Publisher

    def start_link do
      Publisher.start_link(__MODULE__, [])
    end

    def init([]) do
      {:ok, %{subscribers: MapSet.new()}}
    end

    def publish(publisher, message) do
      GenServer.call(publisher, {:publish, message})
    end

    def handle_subscribe(pid, state) do
      {:ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
    end

    def handle_cancel(pid, state) do
      {:ok, %{state | subscribers: MapSet.delete(state.subscribers, pid)}}
    end

    def handle_call({:publish, message}, _from, state) do
      {:reply, :ok, [message], state}
    end

    def subscribers_for_event(_event, state) do
      state.subscribers
    end
  end

  defmodule TestSubscriber do
    use Electric.Subscriber

    def start_link(publisher, name) do
      Subscriber.start_link(__MODULE__, publisher, name)
    end

    def init(name) do
      :ets.new(name, [:protected, :named_table, :ordered_set])
      {:ok, %{table: name, event_index: 0}}
    end

    def handle_event(message, state) do
      # Sleep to ilicit race conditions
      Process.sleep(10)
      :ets.insert(state.table, {state.event_index, message})
      {:noreply, %{state | event_index: state.event_index + 1}}
    end

    def received(name) do
      :ets.tab2list(name)
      |> Enum.map(fn {_, message} -> message end)
    end
  end

  test "sends messages to subscribers" do
    {:ok, publisher} = TestPublisher.start_link()
    {:ok, _} = TestSubscriber.start_link(publisher, :sub1)
    {:ok, _} = TestSubscriber.start_link(publisher, :sub2)
    TestPublisher.publish(publisher, 1)
    TestPublisher.publish(publisher, 2)
    assert TestSubscriber.received(:sub1) == [1, 2]
    assert TestSubscriber.received(:sub2) == [1, 2]
  end
end
