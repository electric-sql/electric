defmodule Support.TransactionProducer do
  use GenStage

  def start_link(args) do
    opts =
      if name = Access.get(args, :name) do
        [name: name]
      else
        []
      end

    GenStage.start_link(__MODULE__, args, opts)
  end

  def emit(pid, changes) do
    GenStage.call(pid, {:emit, changes})
  end

  @impl true
  def init(_args) do
    {:producer, [], dispatcher: GenStage.BroadcastDispatcher}
  end

  @impl true
  def handle_demand(_demand, state) do
    {:noreply, [], state}
  end

  @impl true
  def handle_call({:emit, changes}, _from, state) do
    {:reply, :ok, changes, state}
  end
end
