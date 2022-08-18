defmodule Electric.Replication.Connectors do
  use DynamicSupervisor

  def start_link(extra_args) do
    DynamicSupervisor.start_link(__MODULE__, extra_args, name: __MODULE__)
  end

  @impl true
  def init(_extra_args) do
    DynamicSupervisor.init(strategy: :one_for_one, max_restarts: 0)
  end

  def start_connector(module, args) do
    DynamicSupervisor.start_child(__MODULE__, {module, args})
  end

  def status() do
    __MODULE__
    |> DynamicSupervisor.which_children()
    |> Enum.map(fn {_, pid, _, [module]} -> {module.name(pid), module.status(pid)} end)
  end
end
