defmodule Electric.Shapes.DynamicConsumerSupervisor do
  @moduledoc """
  Responsible for managing shape consumer processes.

  Uses a set of `DynamicSupervisor`s supervised by a parent `DynamicSupervisor`
  to take advantage of the fact that `DynamicSupervisor` terminates its
  children in parallel rather than one at a time.

  This improves shutdown time because all consumer processes are effectively
  terminated simultaneously.
  """
  use DynamicSupervisor

  require Logger

  import Electric, only: [is_stack_id: 1]

  defmodule PartitionDynamicSupervisor do
    @moduledoc false

    use DynamicSupervisor

    def name(stack_id, partition) when is_binary(stack_id) do
      Electric.ProcessRegistry.name(stack_id, __MODULE__, partition)
    end

    def start_link({stack_id, partition}) do
      DynamicSupervisor.start_link(__MODULE__, [stack_id: stack_id],
        name: name(stack_id, partition)
      )
    end

    @impl true
    def init(stack_id: stack_id) do
      Process.set_label({:consumer_supervisor_partition, stack_id})
      Logger.metadata(stack_id: stack_id)
      Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

      DynamicSupervisor.init(strategy: :one_for_one)
    end
  end

  # The max number of processes to start per-partition. Found empirically to
  # give a reasonable tradeoff between memory usage and shutdown speed.
  @target_per_partition 4_000

  @partition_count_key :partition_count

  def name(name) when is_atom(name) do
    name
  end

  def name({:via, _, _} = name) do
    name
  end

  def name(stack_id) when is_binary(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    {name, opts} = Keyword.pop(opts, :name, name(stack_id))
    max_processes = Keyword.get(opts, :max_shapes) || 0
    # use a fixed value for the partition count if its configured, if not then
    # calculate based on the max_shapes setting (using @target_per_partition)
    # or fallback to the number of schedulers
    partitions = Keyword.get(opts, :partitions) || partition_count(max_processes)

    Logger.info("Starting DynamicConsumerSupervisor with #{partitions} partitions")

    with {:ok, supervisor_pid} <-
           DynamicSupervisor.start_link(__MODULE__, %{stack_id: stack_id, partitions: partitions},
             name: name
           ) do
      case start_partition_supervisors(supervisor_pid, stack_id, partitions) do
        {:ok, _pids} ->
          {:ok, supervisor_pid}

        {:error, _} = error ->
          DynamicSupervisor.stop(supervisor_pid, :shutdown)
          error
      end
    end
  end

  defp start_partition_supervisors(supervisor_pid, stack_id, partitions) do
    Electric.Utils.reduce_while_ok(0..(partitions - 1), [], fn partition, pids ->
      with {:ok, pid} <-
             DynamicSupervisor.start_child(
               supervisor_pid,
               Supervisor.child_spec(
                 {PartitionDynamicSupervisor, {stack_id, partition}},
                 id: {:partition, partition}
               )
             ) do
        {:ok, [pid | pids]}
      end
    end)
  end

  def start_shape_consumer(stack_id, config) when is_stack_id(stack_id) do
    start_child(stack_id, {Electric.Shapes.Consumer, config})
  end

  def start_snapshotter(stack_id, config) when is_stack_id(stack_id) do
    start_child(stack_id, {Electric.Shapes.Consumer.Snapshotter, config})
  end

  def start_materializer(stack_id, config) when is_stack_id(stack_id) do
    start_child(stack_id, {Electric.Shapes.Consumer.Materializer, config})
  end

  defp start_child(stack_id, {child_module, child_opts} = child_spec) do
    %{shape_handle: shape_handle} = child_opts

    Logger.debug(fn -> "Starting #{inspect(child_module)} for #{shape_handle}" end)

    DynamicSupervisor.start_child(partition_for(stack_id, shape_handle), child_spec)
  end

  @impl true
  def init(%{stack_id: stack_id, partitions: partitions}) do
    Process.set_label({:dynamic_consumer_supervisor, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    table = :ets.new(table(stack_id), [:named_table, :public, read_concurrency: true])
    true = :ets.insert(table, [{@partition_count_key, partitions}])

    DynamicSupervisor.init(strategy: :one_for_one)
  end

  defp table(stack_id), do: :"Electric.Shapes.DynamicConsumerSupervisor:#{stack_id}"

  defp partition_for(stack_id, shape_handle) do
    partitions = :ets.lookup_element(table(stack_id), @partition_count_key, 2)
    partition = :erlang.phash2(shape_handle, partitions)
    PartitionDynamicSupervisor.name(stack_id, partition)
  end

  # we don't always have a value for `max_processes`, in which case just
  # default to the number of schedulers
  defp partition_count(0) do
    System.schedulers_online()
  end

  defp partition_count(max_processes) when max_processes > 0 do
    max(
      System.schedulers_online(),
      div(max_processes + @target_per_partition - 1, @target_per_partition)
    )
  end
end
