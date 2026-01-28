defmodule Electric.Shapes.SnapshotterSupervisor do
  @moduledoc """
  DynamicSupervisor for snapshotter processes.

  This is separate from the DynamicConsumerSupervisor so that snapshotters
  can be shut down with :brutal_kill for faster shutdown times.
  """
  use DynamicSupervisor

  import Electric, only: [is_stack_id: 1]

  require Logger

  def child_spec(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)

    {name, opts} = Keyword.pop(opts, :name, name(stack_id))

    # We're overriding Electric.Shapes.SnapshotterSupervisor's child_spec() function here
    # to make the usage of PartitionSupervisor transparent to the callers. As a consequence, we
    # need to call `super()` to obtain the original DynamicSupervisor child_spec() to pass as an option to
    # PartitionSupervisor.
    PartitionSupervisor.child_spec(
      child_spec: Supervisor.child_spec(super(opts), shutdown: :brutal_kill),
      name: name
    )
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

  def start_snapshotter(stack_id, config) when is_stack_id(stack_id) do
    %{shape_handle: shape_handle} = config

    routing_key = :erlang.phash2(shape_handle)
    Logger.debug(fn -> "Starting Snapshotter for #{config.shape_handle}" end)

    DynamicSupervisor.start_child(
      {:via, PartitionSupervisor, {name(stack_id), routing_key}},
      {Electric.Shapes.Consumer.Snapshotter, config}
    )
  end

  @impl true
  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:snapshotter_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    DynamicSupervisor.init(strategy: :one_for_one)
  end
end
