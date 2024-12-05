defmodule Electric.Shapes.DynamicConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  alias Electric.Shapes.ConsumerSupervisor

  require Logger

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    DynamicSupervisor.start_link(__MODULE__, [stack_id: stack_id],
      name: Keyword.get(opts, :name, name(stack_id))
    )
  end

  def start_shape_consumer(name, config) do
    Logger.debug(fn -> "Starting consumer for #{Access.fetch!(config, :shape_handle)}" end)

    DynamicSupervisor.start_child(name, {ConsumerSupervisor, config})
  end

  def stop_shape_consumer(_name, stack_id, shape_handle) do
    case GenServer.whereis(ConsumerSupervisor.name(stack_id, shape_handle)) do
      nil ->
        {:error, "no consumer for shape handle #{inspect(shape_handle)}"}

      pid when is_pid(pid) ->
        ConsumerSupervisor.clean_and_stop(%{
          stack_id: stack_id,
          shape_handle: shape_handle
        })

        :ok
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
  def init(stack_id: stack_id) do
    Process.set_label({:dynamic_consumer_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Logger.debug(fn -> "Starting #{__MODULE__}" end)
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
