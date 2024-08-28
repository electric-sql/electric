defmodule Electric.Shapes.ConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  @name __MODULE__

  def start_link(opts) do
    DynamicSupervisor.start_link(__MODULE__, opts, name: @name)
  end

  def start_shape_consumer(config) do
    DynamicSupervisor.start_child(
      @name,
      {Electric.Shapes.ShapeSupervisor, config}
    )
  end

  def stop_shape_consumer(shape_id) do
    case GenServer.whereis(Electric.Shapes.ShapeSupervisor.name(shape_id)) do
      nil ->
        {:error, "no consumer for shape id #{inspect(shape_id)}"}

      pid when is_pid(pid) ->
        DynamicSupervisor.terminate_child(@name, pid)
    end
  end

  @doc false
  def stop_all_consumers do
    for {:undefined, pid, _type, _} when is_pid(pid) <- DynamicSupervisor.which_children(@name) do
      DynamicSupervisor.terminate_child(@name, pid)
    end

    :ok
  end

  @impl true
  def init(_opts) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
