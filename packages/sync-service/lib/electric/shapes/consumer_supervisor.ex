defmodule Electric.Shapes.ConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  alias Electric.Shapes.Consumer

  require Logger

  def name(electric_instance_id) do
    Electric.Application.process_name(electric_instance_id, __MODULE__)
  end

  def start_link(opts) do
    electric_instance_id = Keyword.fetch!(opts, :electric_instance_id)

    DynamicSupervisor.start_link(__MODULE__, [],
      name: Keyword.get(opts, :name, name(electric_instance_id)),
      electric_instance_id: electric_instance_id
    )
  end

  def start_shape_consumer(name, config) do
    Logger.debug(fn -> "Starting consumer for #{Access.fetch!(config, :shape_id)}" end)

    DynamicSupervisor.start_child(name, {Consumer.Supervisor, config})
  end

  def stop_shape_consumer(electric_instance_id, name, shape_id) do
    case GenServer.whereis(Consumer.Supervisor.name(electric_instance_id, shape_id)) do
      nil ->
        {:error, "no consumer for shape id #{inspect(shape_id)}"}

      pid when is_pid(pid) ->
        DynamicSupervisor.terminate_child(name, pid)
    end
  end

  @doc false
  def stop_all_consumers(name) do
    for {:undefined, pid, _type, _} when is_pid(pid) <- DynamicSupervisor.which_children(name) do
      DynamicSupervisor.terminate_child(name, pid)
    end

    :ok
  end

  @impl true
  def init(_opts) do
    Logger.debug(fn -> "Starting #{__MODULE__}" end)
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
