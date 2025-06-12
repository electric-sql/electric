defmodule Electric.Shapes.Monitor do
  use Supervisor

  alias __MODULE__.RefCounter

  @type stack_id :: Electric.stack_id()
  @type shape_handle :: Electric.ShapeCache.shape_handle()

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
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

  @doc """
  Register the current process as a reader of the given shape.
  """
  @spec register_reader(stack_id(), shape_handle(), pid()) :: :ok
  defdelegate register_reader(stack_id, shape_handle, pid \\ self()), to: RefCounter

  @doc """
  Unregister the current process as a reader of the given shape.
  """
  @spec unregister_reader(stack_id(), shape_handle(), pid()) :: :ok
  defdelegate unregister_reader(stack_id, shape_handle, pid \\ self()), to: RefCounter

  @doc """
  Register the current process as a writer (consumer) of the given shape.
  """
  @spec register_writer(stack_id(), shape_handle(), pid()) :: :ok | {:error, term()}
  defdelegate register_writer(stack_id, shape_handle, shape, pid \\ self()), to: RefCounter

  @doc """
  The number of active readers of the given shape.
  """
  @spec reader_count(stack_id(), shape_handle()) :: {:ok, non_neg_integer()}
  defdelegate reader_count(stack_id, shape_handle), to: RefCounter

  @doc """
  The number of active readers of all shapes.
  """
  @spec reader_count(stack_id()) :: {:ok, non_neg_integer()}
  defdelegate reader_count(stack_id), to: RefCounter

  @doc """
  The number of active readers of all shapes.
  """
  @spec reader_count!(stack_id()) :: non_neg_integer()
  defdelegate reader_count!(stack_id), to: RefCounter

  @doc """
  Request a message when all readers of the given handle have finished or terminated.

  Sends `{Electric.Shapes.Monitor, :reader_termination, shape_handle, reason}`
  to the registered `pid` when the reader count on a shape is `0`.
  """
  @spec notify_reader_termination(stack_id(), shape_handle(), term(), pid()) :: :ok
  defdelegate notify_reader_termination(stack_id, shape_handle, reason, pid \\ self()),
    to: RefCounter

  @doc """
  clean up the state of a non-running consumer.
  """
  @spec purge_shape(stack_id(), shape_handle(), Electric.Shapes.Shape.t()) :: :ok
  defdelegate purge_shape(stack_id, shape_handle, shape), to: RefCounter

  # used in tests to validate internal state
  @doc false
  defdelegate termination_watchers(stack_id, shape_handle), to: RefCounter

  def init(opts) do
    %{
      stack_id: stack_id,
      storage: storage,
      publication_manager: publication_manager,
      shape_status: shape_status
    } = opts

    Process.set_label({:shapes_monitor, stack_id})

    children = [
      {__MODULE__.CleanupTaskSupervisor, stack_id: stack_id},
      {__MODULE__.RefCounter,
       stack_id: stack_id,
       storage: storage,
       publication_manager: publication_manager,
       shape_status: shape_status,
       on_remove: Map.get(opts, :on_remove),
       on_cleanup: Map.get(opts, :on_cleanup)}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end
end
