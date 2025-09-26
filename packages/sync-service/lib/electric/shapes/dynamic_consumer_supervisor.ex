defmodule Electric.Shapes.DynamicConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  alias Electric.Shapes.ConsumerSupervisor

  require Logger

  def partition_supervisor_spec(stack_id) do
    {PartitionSupervisor, child_spec: {__MODULE__, [stack_id: stack_id]}, name: name(stack_id)}
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    DynamicSupervisor.start_link(__MODULE__, stack_id: stack_id)
  end

  def start_shape_consumer(name, config) do
    Logger.debug(fn -> "Starting consumer for #{Keyword.fetch!(config, :shape_handle)}" end)

    key = :rand.uniform(256)

    DynamicSupervisor.start_child(
      {:via, PartitionSupervisor, {name, key}},
      {ConsumerSupervisor, config}
    )
  end

  @impl true
  def init(stack_id: stack_id) do
    Process.set_label({:dynamic_consumer_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)
    Logger.debug(fn -> "Starting #{__MODULE__}" end)
    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
