defmodule Support.StubMaterializer do
  use GenServer, restart: :temporary

  def start_link(opts) do
    opts = Map.new(opts)
    GenServer.start_link(__MODULE__, opts, name: Electric.Shapes.Consumer.Materializer.name(opts))
  end

  def init(opts) do
    {:ok, %{current_values: Map.get(opts, :initial_values, MapSet.new())}}
  end

  def set_link_values(name, values) do
    GenServer.call(Electric.Shapes.Consumer.Materializer.name(name), {:set_link_values, values})
  end

  def handle_call(:get_link_values, _from, state) do
    {:reply, state.current_values, state}
  end

  def handle_call({:set_link_values, values}, _from, state) do
    {:reply, :ok, %{state | current_values: MapSet.new(values)}}
  end
end
