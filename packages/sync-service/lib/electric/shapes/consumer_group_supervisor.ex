defmodule Electric.Shapes.ConsumerGroupSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  alias Electric.Shapes.Consumer

  require Logger

  @name Electric.Application.process_name(__MODULE__)

  def name do
    @name
  end

  def name(id) do
    Electric.Application.process_name(__MODULE__, id)
  end

  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, [], name: Keyword.get(opts, :name, @name))
  end

  def start_shape_consumer(name \\ @name, config) do
    Logger.debug(fn -> "Starting consumer for #{Access.fetch!(config, :shape_id)}" end)

    DynamicSupervisor.start_child(name, {Consumer.Supervisor, config})
  end

  def stop_shape_consumer(name \\ @name, shape_id) do
    case GenServer.whereis(Consumer.Supervisor.name(shape_id)) do
      nil ->
        {:error, "no consumer for shape id #{inspect(shape_id)}"}

      pid when is_pid(pid) ->
        DynamicSupervisor.terminate_child(name, pid)
    end
  end

  @doc false
  def stop_all_consumers(name \\ @name) do
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
