defmodule Electric.Publisher do
  defmacro __using__(_opts) do
    quote do
      alias Electric.Publisher
    end
  end

  def start_link(module, args, opts \\ []) do
    GenServer.start_link(__MODULE__, {module, args}, opts)
  end

  def init({module, args}) do
    with {:ok, inner_state} <- module.init(args) do
      {:ok, %{module: module, inner_state: inner_state, publication: nil}}
    end
  end

  def subscribe(publisher) do
    GenServer.call(publisher, :subscribe)
  end

  def handle_call(:subscribe, {pid, _}, state) do
    {:ok, inner_state} = state.module.handle_subscribe(pid, state.inner_state)

    {:reply, :ok, %{state | inner_state: inner_state}}
  end

  def handle_call(message, from, state) do
    case state.module.handle_call(message, from, state.inner_state) do
      {:reply, reply, events, inner_state} ->
        {:noreply, send_events_then_reply(events, reply, from, inner_state, state)}
    end
  end

  defp send_events_then_reply([], reply, from, inner_state, state) do
    GenServer.reply(from, reply)
    %{state | inner_state: inner_state}
  end

  defp send_events_then_reply([event], reply, from, inner_state, %{publication: nil} = state) do
    subscribers = state.module.subscribers_for_event(event, inner_state)

    Enum.each(subscribers, fn subscriber ->
      GenServer.cast(subscriber, {:event, event, self()})
    end)

    %{
      state
      | inner_state: inner_state,
        publication: %{reply: reply, from: from, subscribers: subscribers}
    }
  end

  defp send_events_then_reply([_ | _], _, _, _, %{publication: nil} = state) do
    raise "#{state.module} returned more than 1 event. Only one event can be sent at a time."
  end

  defp send_events_then_reply(_events, _reply, _from, _inner_state, state) do
    raise "#{state.module} returned events while already having a pending reply. "
  end

  def handle_cast({:event_processed, subscriber}, state) do
    subscribers = MapSet.delete(state.publication.subscribers, subscriber)

    if MapSet.size(subscribers) == 0 do
      GenServer.reply(state.publication.from, state.publication.reply)
      {:noreply, %{state | publication: nil}}
    else
      {:noreply, %{state | publication: %{state.publication | subscribers: subscribers}}}
    end
  end
end
