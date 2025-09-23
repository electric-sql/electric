defmodule Electric.ShapeCache.ShapeCleaner do
  @moduledoc """
  Removes a shape (consumer, status entry, on-disk data and publication entry) on demand.

  This process ensures removing of shapes does not block critical path of shape creation.
  """
  use GenServer
  require Logger

  alias Electric.Shapes.ConsumerSupervisor
  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true]
          )

  # Public API
  @spec remove_shape(shape_handle(), Keyword.t()) :: :ok | {:error, term()}
  def remove_shape(shape_handle, opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    server = Keyword.get(opts, :server, name(stack_id))
    timeout = Keyword.get(opts, :timeout, 15_000)
    GenServer.call(server, {:remove_shape, shape_handle}, timeout)
  end

  @spec remove_shapes_for_relations(list(Electric.oid_relation()), Keyword.t()) :: :ok
  def remove_shapes_for_relations(relations, opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    server = Keyword.get(opts, :server, name(stack_id))
    # We don't want for this call to be blocking because it will be called in `PublicationManager`
    # if it notices a discrepancy in the schema
    GenServer.cast(server, {:clean_all_shapes_for_relations, relations})
  end

  def name(stack_id), do: Electric.ProcessRegistry.name(stack_id, __MODULE__)

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      opts = Keyword.put_new(opts, :on_cleanup, fn _ -> :ok end)
      stack_id = Keyword.fetch!(opts, :stack_id)
      GenServer.start_link(__MODULE__, opts, name: name(stack_id))
    end
  end

  # GenServer callbacks
  @impl true
  def init(opts) do
    Process.set_label({:shape_remover, opts[:stack_id]})
    Logger.metadata(stack_id: opts[:stack_id])
    Electric.Telemetry.Sentry.set_tags_context(stack_id: opts[:stack_id])

    {:ok,
     %{
       stack_id: opts[:stack_id],
       shape_status: Keyword.fetch!(opts, :shape_status),
       queued_removals: []
     }}
  end

  @impl true
  def handle_call({:remove_shape, shape_handle}, _from, state) do
    :ok = stop_and_clean_shape(shape_handle, state)
    {:reply, :ok, state}
  end

  @impl true
  def handle_cast({:clean_all_shapes_for_relations, relations}, state) do
    {shape_status, shape_status_state} = state.shape_status

    affected_shapes =
      shape_status.list_shape_handles_for_relations(
        shape_status_state,
        relations
      )

    if relations != [] do
      Logger.info(fn ->
        "Cleaning up all shapes for relations #{inspect(relations)}: #{length(affected_shapes)} shapes total"
      end)
    end

    # schedule these shape removals one by one to avoid blocking the GenServer
    # for too long to allow interleaved sync removals

    {:noreply, %{state | queued_removals: state.queued_removals ++ affected_shapes}}
  end

  def handle_cast(:remove_queued_shapes, %{queued_removals: []} = state) do
    {:noreply, state}
  end

  def handle_cast(:remove_queued_shapes, %{queued_removals: [next_shape | rest]} = state) do
    :ok = stop_and_clean_shape(next_shape, state)
    # schedule the next removal immediately
    send(self(), :remove_queued_shapes)
    {:noreply, %{state | queued_removals: rest}}
  end

  @impl true
  def handle_info({:remove_shape, shape_handle}, state) do
    Logger.debug("Removing shape #{inspect(shape_handle)}")
    :ok = stop_and_clean_shape(shape_handle, state)
    {:noreply, state}
  end

  defp stop_and_clean_shape(shape_handle, state) do
    Logger.debug("Removing shape #{inspect(shape_handle)}")

    case ConsumerSupervisor.stop_and_clean(state.stack_id, shape_handle) do
      :noproc ->
        # if the consumer isn't running then we can just delete things gratuitously,
        # starting with an immediate shape status removal
        {shape_status, shape_status_state} = state.shape_status
        shape_status.remove_shape(shape_status_state, shape_handle)

        :ok = purge_shape(state.stack_id, shape_handle)

      :ok ->
        # if it is running then the stop_and_clean process will cleanup properly
        :ok
    end
  end

  defdelegate purge_shape(stack_id, shape_handle), to: Electric.Shapes.Monitor
end
