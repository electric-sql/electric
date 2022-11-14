defmodule Electric.Replication.Connectors do
  use DynamicSupervisor

  def start_link(extra_args) do
    DynamicSupervisor.start_link(__MODULE__, extra_args, name: __MODULE__)
  end

  @impl DynamicSupervisor
  def init(_extra_args) do
    DynamicSupervisor.init(strategy: :one_for_one, max_restarts: 0)
  end

  @spec start_connector(module(), term()) :: Supervisor.on_start()
  def start_connector(module, args) do
    DynamicSupervisor.start_child(__MODULE__, {module, args})
  end

  @spec stop_connector(pid()) :: :ok | {:error, term()}
  def stop_connector(pid) do
    DynamicSupervisor.terminate_child(__MODULE__, pid)
  end

  def status(opt \\ :pretty) do
    map_fun =
      case opt do
        :pretty ->
          fn {_, pid, _, [module]} -> {module.name(pid), module.status(pid)} end

        :raw ->
          fn {_, pid, _, [module]} -> {module, pid} end
      end

    __MODULE__
    |> DynamicSupervisor.which_children()
    |> Enum.map(map_fun)
  end
end
