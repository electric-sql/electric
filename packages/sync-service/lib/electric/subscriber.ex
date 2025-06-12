defmodule Electric.Subscriber do
  defmacro __using__(_opts) do
    quote do
      alias Electric.Subscriber
    end
  end

  alias Electric.Publisher

  def start_link(module, publisher, args, opts \\ []) do
    GenServer.start_link(__MODULE__, {publisher, module, args}, opts)
  end

  def init({publisher, module, args}) do
    with {:ok, inner_state} <- module.init(args) do
      Publisher.subscribe(publisher)
      {:ok, %{module: module, inner_state: inner_state}}
    end
  end

  def handle_cast({:event, event, publisher}, state) do
    case state.module.handle_event(event, state.inner_state) do
      {:noreply, inner_state} ->
        GenServer.cast(publisher, {:event_processed, self()})
        {:noreply, %{state | inner_state: inner_state}}
    end
  end

  def handle_call(message, from, state) do
    case state.module.handle_call(message, from, state.inner_state) do
      {:reply, reply, inner_state} ->
        {:reply, reply, %{state | inner_state: inner_state}}
    end
  end
end
