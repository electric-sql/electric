defmodule Electric.DummyConsumer do
  use GenStage

  def start_link(opts) do
    GenStage.start_link(__MODULE__, opts, Keyword.take(opts, [:name]))
  end

  def init(opts) do
    {:consumer,
     %{
       notify: Keyword.get(opts, :notify),
       run_on_each_event: Keyword.get(opts, :run_on_each_event, & &1)
     }, Keyword.take(opts, [:subscribe_to])}
  end

  def notify(%{notify: nil}, _, _), do: :ok

  def notify(%{notify: target}, producer_pid, events) when is_pid(target) or is_atom(target),
    do: send(target, {:dummy_consumer, producer_pid, events})

  def handle_events(events, {pid, _}, state) do
    # The __MODULE__ here is to allow mocking out the `notify` function at the place of call to "inject" test's pid
    __MODULE__.notify(state, pid, events)

    Enum.each(events, state.run_on_each_event)

    {:noreply, [], state}
  end
end
