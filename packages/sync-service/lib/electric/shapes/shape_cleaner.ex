defmodule Electric.Shapes.ShapeCleaner do
  use GenServer

  alias Electric.ShapeCache.ShapeStatus

  require Logger

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            name: [
              type: @genserver_name_schema,
              required: false
            ],
            stack_id: [type: :string, required: true],
            publication_manager: [type: :mod_arg, required: true],
            storage: [type: :mod_arg, required: true],
            shape_status: [type: :atom, default: Electric.ShapeCache.ShapeStatus]
          )

  defguardp is_consumer_shutdown_with_data_retention?(reason)
            when reason in [:normal, :killed, :shutdown] or
                   (is_tuple(reason) and elem(reason, 0) == :shutdown and
                      elem(reason, 1) != :cleanup)

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      stack_id = Keyword.fetch!(opts, :stack_id)
      name = Keyword.get(opts, :name, name(stack_id))

      GenServer.start_link(__MODULE__, [name: name] ++ opts, name: name)
    end
  end

  @doc """
  Monitor a shape to ensure it is cleaned up when it is terminated
  """
  def monitor_shape(shape_handle, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:monitor_shape, shape_handle})
  end

  @doc """
  Ensure that the shape is cleaned up.
  Does not clean up publication, only runs idempotent cleanups
  """
  def ensure_shape_cleanup(shape_handle, opts \\ []) do
    server = Access.get(opts, :server, name(opts))
    GenServer.call(server, {:ensure_shape_cleanup, shape_handle})
  end

  @impl true
  def init(opts) do
    opts = Map.new(opts)
    stack_id = opts.stack_id

    Process.set_label({:shape_cleaner, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok,
     %{
       name: opts.name,
       stack_id: stack_id,
       publication_manager: opts.publication_manager,
       storage: opts.storage,
       shape_status:
         {opts.shape_status,
          %ShapeStatus{shape_meta_table: Electric.ShapeCache.get_shape_meta_table(opts)}}
     }}
  end

  @impl true
  def handle_call({:monitor_shape, shape_handle}, _from, state) do
    # monitor the consumer to ensure we clean up killed shapes
    shape_consumer_pid = Electric.Shapes.Consumer.whereis(state.stack_id, shape_handle)
    Process.monitor(shape_consumer_pid, tag: {:consumer_down, shape_handle})

    {:reply, :ok, state}
  end

  def handle_call({:ensure_shape_cleanup, shape_handle}, _from, state) do
    case Electric.Shapes.Consumer.whereis(state.stack_id, shape_handle) do
      nil ->
        unsafe_cleanup_shape!(shape_handle, state)
        {:reply, :ok, state}

      _ ->
        {:reply,
         {:error,
          "Expected shape #{shape_handle} consumer to not be alive before cleaning shape"}, state}
    end
  end

  @impl true

  def handle_info({{:consumer_down, shape_handle}, _ref, :process, _pid, reason}, state)
      when not is_consumer_shutdown_with_data_retention?(reason) do
    Logger.debug("Cleaning up shape #{shape_handle} after consumer exit: #{inspect(reason)}")

    {shape_status, shape_status_state} = state.shape_status
    {publication_manager, publication_manager_opts} = state.publication_manager

    with {:ok, shape} <-
           shape_status.shape_definition(shape_status_state, shape_handle) do
      # clean up publication and data related to shape
      publication_manager.remove_shape_async(shape, publication_manager_opts)
    end

    unsafe_cleanup_shape!(shape_handle, state)
    {:noreply, state}
  end

  def handle_info({{:consumer_down, _shape_handle}, _ref, :process, _pid, _reason}, state) do
    # ignore non-cleanup consumer shutdowns
    {:noreply, state}
  end

  def handle_info({:DOWN, _ref, :process, _pid, _reason}, state) do
    # ignore down messages from task failures
    {:noreply, state}
  end

  def handle_info({_ref, :ok}, state) do
    # ignore async task completions
    {:noreply, state}
  end

  defp unsafe_cleanup_shape!(shape_handle, state) do
    # Remove the handle from the shape status
    {shape_status, shape_status_state} = state.shape_status

    shape_status.remove_shape(shape_status_state, shape_handle)

    # Cleanup the storage for the shape, asynchronously to avoid
    # blocking in memory cleanups due to slow IO
    Task.async(fn ->
      shape_handle
      |> Electric.ShapeCache.Storage.for_shape(state.storage)
      |> Electric.ShapeCache.Storage.unsafe_cleanup!()
    end)
  end
end
