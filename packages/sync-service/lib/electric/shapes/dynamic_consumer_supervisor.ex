defmodule Electric.Shapes.DynamicConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes
  """
  use DynamicSupervisor

  require Logger

  @doc """
  Returns a child spec for the PartitionSupervisor that starts a pool of
  DynamicConsumerSupervisor procecesses to shard child processes across.

  The number of dynamic supervisors is equal to the number of CPU cores.
  """
  def child_spec(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    {name, opts} = Keyword.pop(opts, :name, name(stack_id))

    # We're overriding Electric.Shapes.DynamicConsumerSupervisor's child_spec() function here
    # to make the usage of PartitionSupervisor transparent to the callers. As a consequence, we
    # need to call `super()` to obtain the original DynamicSupervisor child_spec() to pass as an option to
    # PartitionSupervisor.
    PartitionSupervisor.child_spec(child_spec: super(opts), name: name)
  end

  def name(name) when is_atom(name) do
    name
  end

  def name({:via, _, _} = name) do
    name
  end

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  # This function will be invoked for each dynamic supervisor process in PartitionSupervisor's
  # pool, so we keep these processes unnamed.
  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    DynamicSupervisor.start_link(__MODULE__, stack_id: stack_id)
  end

  def start_shape_consumer(supervisor_ref, config) do
    start_child(supervisor_ref, {Electric.Shapes.Consumer, config})
  end

  def start_materializer(supervisor_ref, config) do
    start_child(supervisor_ref, {Electric.Shapes.Consumer.Materializer, config})
  end

  defp start_child(supervisor_ref, {child_module, child_opts} = child_spec) do
    %{shape_handle: shape_handle} = child_opts

    routing_key = :erlang.phash2(shape_handle)

    Logger.debug(fn -> "Starting #{inspect(child_module)} for #{shape_handle}" end)

    DynamicSupervisor.start_child(
      {:via, PartitionSupervisor, {name(supervisor_ref), routing_key}},
      child_spec
    )
  end

  @impl true
  def init(stack_id: stack_id) do
    Process.set_label({:dynamic_consumer_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
