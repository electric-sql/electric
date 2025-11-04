defmodule Electric.ShapeCache.ShapeCleaner do
  @moduledoc """
  Removes a shape (consumer, status entry, on-disk data and publication entry) on demand.

  This process ensures removing of shapes does not block critical path of shape creation.
  """
  use GenServer

  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.ShapeStatus

  require Logger

  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()

  @schema NimbleOptions.new!(stack_id: [type: :string, required: true])

  # Public API
  @spec remove_shape(shape_handle(), Keyword.t()) :: :ok | {:error, term()}
  def remove_shape(shape_handle, stack_id, opts \\ []) do
    timeout = Keyword.get(opts, :timeout, 15_000)
    GenServer.call(name(stack_id), {:remove_shape, shape_handle}, timeout)
  end

  @spec remove_shape(shape_handle(), Keyword.t()) :: :ok
  def remove_shape_async(shape_handle, stack_id) do
    GenServer.cast(name(stack_id), {:remove_shape, shape_handle})
  end

  @spec remove_shapes_for_relations(list(Electric.oid_relation()), Keyword.t()) :: :ok
  def remove_shapes_for_relations([], _stack_id) do
    :ok
  end

  def remove_shapes_for_relations(relations, stack_id) do
    # We don't want for this call to be blocking because it will be called in `PublicationManager`
    # if it notices a discrepancy in the schema
    GenServer.cast(name(stack_id), {:clean_all_shapes_for_relations, relations})
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
       queued_removals: []
     }}
  end

  @impl true
  def handle_call({:remove_shape, shape_handle}, _from, state) do
    :ok = stop_and_clean_shape(shape_handle, state.stack_id)
    {:reply, :ok, state}
  end

  @impl true
  def handle_cast({:remove_shape, shape_handle}, state) do
    :ok = stop_and_clean_shape(shape_handle, state)
    {:noreply, state}
  end

  def handle_cast({:clean_all_shapes_for_relations, relations}, state) do
    affected_shapes =
      ShapeStatus.list_shape_handles_for_relations(state.stack_id, relations)

    Logger.info(fn ->
      "Cleaning up all shapes for relations #{inspect(relations)}: #{length(affected_shapes)} shapes total"
    end)

    # schedule these shape removals one by one to avoid blocking the GenServer
    # for too long to allow interleaved sync removals

    new_queue = state.queued_removals ++ affected_shapes

    # kick off processing if we just enqueued new shapes and weren't already processing
    if affected_shapes != [] and state.queued_removals == [] do
      GenServer.cast(self(), :remove_queued_shapes)
    end

    {:noreply, %{state | queued_removals: new_queue}}
  end

  def handle_cast(:remove_queued_shapes, %{queued_removals: []} = state) do
    {:noreply, state}
  end

  def handle_cast(:remove_queued_shapes, %{queued_removals: [next_shape | rest]} = state) do
    :ok = stop_and_clean_shape(next_shape, state.stack_id)
    # schedule the next removal immediately via another cast to keep mailbox ordering
    if rest != [] do
      GenServer.cast(self(), :remove_queued_shapes)
    end

    {:noreply, %{state | queued_removals: rest}}
  end

  @impl true
  def handle_info({:remove_shape, shape_handle}, state) do
    Logger.debug("Removing shape #{inspect(shape_handle)}")
    :ok = stop_and_clean_shape(shape_handle, state.stack_id)
    {:noreply, state}
  end

  defp stop_and_clean_shape(shape_handle, stack_id) do
    Logger.debug("Removing shape #{inspect(shape_handle)}")

    case Consumer.stop_and_clean(stack_id, shape_handle) do
      :noproc ->
        # if the consumer isn't running then we can just delete things gratuitously,
        # starting with an immediate shape status removal
        ShapeStatus.remove_shape(stack_id, shape_handle)

        :ok = purge_shape(stack_id, shape_handle)

      :ok ->
        # if it is running then the stop_and_clean process will cleanup properly
        :ok
    end
  end

  defdelegate purge_shape(stack_id, shape_handle), to: Electric.Shapes.Monitor
end
