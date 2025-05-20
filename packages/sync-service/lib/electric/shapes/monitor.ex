defmodule Electric.Shapes.Monitor do
  use Supervisor

  alias __MODULE__.RefCounter
  alias __MODULE__.Partitions

  require Logger

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            partitions: [type: :pos_integer],
            storage: [type: :mod_arg, required: true],
            shape_status: [type: :mod_arg, required: true],
            publication_manager: [type: :mod_arg, required: true],
            on_remove: [type: {:or, [nil, {:fun, 2}]}],
            on_cleanup: [type: {:or, [nil, {:fun, 1}]}]
          )

  def name(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def start_link(args) do
    with {:ok, config} <- NimbleOptions.validate(Map.new(args), @schema) do
      Supervisor.start_link(__MODULE__, config, name: name(config.stack_id))
    end
  end

  @doc false
  def partitions(stack_id) when is_binary(stack_id) do
    Partitions.count(stack_id)
  end

  def partitions(n) when is_integer(n) do
    n
  end

  defp partition_list(stack_id) do
    0..(partitions(stack_id) - 1)
  end

  @doc false
  def shape_partition(stack_id, shape_handle) do
    :erlang.phash2(shape_handle, partitions(stack_id))
  end

  @doc """
  Register the current process as a reader of the given shape.
  """
  @spec register_reader(stack_id(), shape_handle(), pid()) :: :ok
  def register_reader(stack_id, shape_handle, pid \\ self()) do
    # test (quickly) if any other partition has this pid registered for another handle
    # if so, trigger the removal of that reader then register as usual
    partitions = partitions(stack_id)
    partition = :erlang.phash2(shape_handle, partitions)

    moved? =
      0..(partitions - 1)
      |> Enum.reduce_while(false, fn
        ^partition, acc ->
          {:cont, acc}

        p, _acc ->
          if RefCounter.deregister_if_owned(stack_id, p, pid),
            do: {:halt, true},
            else: {:cont, false}
      end)

    if moved?,
      do:
        Logger.debug(fn ->
          "process #{inspect(pid)} re-registered to new partition: #{inspect(shape_handle)}"
        end)

    RefCounter.register_reader(stack_id, partition, shape_handle, pid)
  end

  @doc """
  Unregister the current process as a reader of the given shape.
  """
  @spec unregister_reader(stack_id(), shape_handle(), pid()) :: :ok
  def unregister_reader(stack_id, shape_handle, pid \\ self()) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.unregister_reader(stack_id, partition, shape_handle, pid)
  end

  @doc """
  Register the current process as a writer (consumer) of the given shape.
  """
  @spec register_writer(stack_id(), shape_handle(), pid()) :: :ok | {:error, term()}
  def register_writer(stack_id, shape_handle, pid \\ self()) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.register_writer(stack_id, partition, shape_handle, pid)
  end

  @doc """
  The number of active readers of the given shape.
  """
  @spec reader_count(stack_id(), shape_handle()) :: {:ok, non_neg_integer()}
  def reader_count(stack_id, shape_handle) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.reader_count(stack_id, partition, shape_handle)
  end

  @doc """
  The number of active readers of all shapes.
  """
  @spec reader_count(stack_id()) :: {:ok, non_neg_integer()}
  def reader_count(stack_id) do
    {
      :ok,
      stack_id
      |> partition_list()
      |> Enum.reduce(0, fn partition, sum ->
        {:ok, count} = RefCounter.reader_count(stack_id, partition)
        sum + count
      end)
    }
  end

  @doc """
  The number of active readers of all shapes.
  """
  @spec reader_count!(stack_id()) :: non_neg_integer()
  def reader_count!(stack_id) do
    {:ok, count} = reader_count(stack_id)
    count
  end

  @doc """
  Request a message when all readers of the given handle have finished or terminated.

  Sends `{Electric.Shapes.Monitor, :reader_termination, shape_handle, reason}`
  to the registered `pid` when the reader count on a shape is `0`.
  """
  @spec notify_reader_termination(stack_id(), shape_handle(), term(), pid()) :: :ok
  def notify_reader_termination(stack_id, shape_handle, reason, pid \\ self()) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.notify_reader_termination(stack_id, partition, shape_handle, reason, pid)
  end

  @doc """
  clean up the state of a non-running consumer.
  """
  @spec purge_shape(stack_id(), shape_handle(), Electric.Shapes.Shape.t()) :: :ok
  def purge_shape(stack_id, shape_handle, shape) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.purge_shape(stack_id, partition, shape_handle, shape)
  end

  # used in tests to validate internal state
  @doc false
  def termination_watchers(stack_id, shape_handle) do
    partition = shape_partition(stack_id, shape_handle)
    RefCounter.termination_watchers(stack_id, partition, shape_handle)
  end

  def init(opts) do
    %{
      stack_id: stack_id,
      storage: storage,
      publication_manager: publication_manager,
      shape_status: shape_status
    } = opts

    partitions = Map.get(opts, :partitions, System.schedulers_online())

    Logger.info("starting #{inspect(__MODULE__)} with #{partitions} partitions")

    partition_children =
      Enum.map(0..(partitions - 1), fn partition ->
        {__MODULE__.RefCounter,
         stack_id: stack_id,
         partition: partition,
         storage: storage,
         publication_manager: publication_manager,
         shape_status: shape_status,
         on_remove: Map.get(opts, :on_remove),
         on_cleanup: Map.get(opts, :on_cleanup)}
      end)

    children =
      [
        {__MODULE__.Partitions, stack_id: stack_id, partitions: partitions},
        {__MODULE__.CleanupTaskSupervisor, stack_id: stack_id}
      ] ++ partition_children

    Supervisor.init(children, strategy: :one_for_one)
  end
end

defmodule Electric.Shapes.Monitor.Partitions do
  @moduledoc false

  # Just owns the ets table with the number of partitions for the given stack

  use GenServer

  @key :partition_count

  def start_link(args) do
    GenServer.start_link(__MODULE__, args)
  end

  def table(stack_id) do
    :"Elixir.Electric.Shapes.Monitor.Partitions.#{stack_id}"
  end

  def count(stack_id) do
    case :ets.lookup(table(stack_id), @key) do
      [{@key, partitions}] -> partitions
    end
  end

  def init(stack_id: stack_id, partitions: partitions) do
    table =
      :ets.new(table(stack_id), [
        :protected,
        :named_table,
        read_concurrency: true
      ])

    :ets.insert(table, {@key, partitions})

    {:ok, table}
  end
end
