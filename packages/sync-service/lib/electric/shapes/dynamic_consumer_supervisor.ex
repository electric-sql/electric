defmodule Electric.Shapes.DynamicConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  alias Electric.Shapes.ConsumerSupervisor

  require Logger

  @doc """
  Returns a child spec for the PartitionSupervisor that starts a pool of
  DynamicConsumerSupervisor procecesses to shard child processes across.

  The number of dynamic supervisors is equal to the number of CPU cores.
  """
  def partition_supervisor_spec(stack_id) do
    {PartitionSupervisor, child_spec: {__MODULE__, [stack_id: stack_id]}, name: name(stack_id)}
  end

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  # This function will be invoked for each dynamic supervisor process in PartitionSupervisor's
  # pool, so we keep these processes unnamed.
  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    DynamicSupervisor.start_link(__MODULE__, stack_id: stack_id)
  end

  def start_shape_consumer(name, config) do
    Logger.debug(fn -> "Starting consumer for #{Keyword.fetch!(config, :shape_handle)}" end)

    # Use a random integer as the routing key to achieve balanced sharding of child processes
    # across all dynamic supervisors. The top limit for the key is picked to future-proof it
    # for cases where Electric runs on a CPU with many cores. 256 should be sufficient for the
    # foreseeable future.
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
