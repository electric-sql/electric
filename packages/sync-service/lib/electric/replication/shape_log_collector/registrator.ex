defmodule Electric.Replication.ShapeLogCollector.Registrator do
  use GenServer

  require Logger
  import Electric, only: [is_stack_id: 1]
  alias Electric.Replication.ShapeLogCollector

  @enforce_keys [
    :stack_id,
    :to_add,
    :to_remove,
    :to_schedule_waiters,
    :ack_waiters,
    :ack_ref
  ]
  defstruct @enforce_keys

  @typep registration_waiter :: {GenServer.from(), Electric.shape_handle()}
  @type t :: %__MODULE__{
          stack_id: Electric.stack_id(),
          to_add: %{Electric.shape_handle() => Electric.Replication.Shape.t()},
          to_remove: MapSet.t(Electric.shape_handle()),
          to_schedule_waiters: [registration_waiter()],
          ack_waiters: [registration_waiter()],
          ack_ref: reference() | nil
        }

  @spec name(Electric.stack_id()) :: GenServer.name()
  def name(stack_id) when is_stack_id(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @spec subscribe(
          Electric.stack_id(),
          Electric.shape_handle(),
          Electric.Shapes.Shape.t(),
          :create | :restore
        ) :: :ok
  # shapes that are being restored are already in the filters
  # because they were restored from the ets at startup
  def subscribe(_stack_id, _shape_handle, _shape, :restore) do
    :ok
  end

  # new shapes -- created after boot -- do need to be added
  def subscribe(stack_id, shape_handle, shape, :create) do
    GenServer.call(name(stack_id), {:add_shape, shape_handle, shape})
  end

  @spec remove_shape(Electric.stack_id(), Electric.shape_handle()) :: :ok
  def remove_shape(stack_id, shape_handle) do
    # This has to be async otherwise the system will deadlock -
    # - a consumer being cleanly shutdown may be waiting for a response from ShapeLogCollector
    #   while ShapeLogCollector is waiting for an ack from a transaction event, or
    # - a consumer that has crashed will be waiting in a terminate callback
    #   for a reply from the unsubscribe while the ShapeLogCollector is again
    #   waiting for a txn ack.
    GenServer.cast(name(stack_id), {:remove_shape, shape_handle})
  end

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts[:stack_id]))
  end

  @impl true
  def init(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    Process.set_label({:shape_log_collector_registrator, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok,
     %__MODULE__{
       stack_id: stack_id,
       to_add: %{},
       to_remove: MapSet.new(),
       to_schedule_waiters: [],
       ack_waiters: [],
       ack_ref: nil
     }}
  end

  @impl true
  def handle_call({:add_shape, shape_handle, shape}, from, state) do
    {:noreply,
     %{
       state
       | to_add: Map.put(state.to_add, shape_handle, shape),
         to_remove: MapSet.delete(state.to_remove, shape_handle),
         to_schedule_waiters: [{from, shape_handle} | state.to_schedule_waiters]
     }, {:continue, :maybe_schedule_update}}
  end

  @impl true
  def handle_cast({:remove_shape, shape_handle}, state) do
    {:noreply,
     %{
       state
       | to_add: Map.delete(state.to_add, shape_handle),
         to_remove: MapSet.put(state.to_remove, shape_handle)
     }, {:continue, :maybe_schedule_update}}
  end

  @impl true
  def handle_info({ref, {:ok, results}}, %{ack_ref: ref} = state) do
    for {from, shape_handle} <- state.ack_waiters do
      GenServer.reply(from, Map.fetch!(results, shape_handle))
    end

    {
      :noreply,
      %{state | ack_ref: nil, ack_waiters: []},
      {:continue, :maybe_schedule_update}
    }
  end

  @impl true

  def handle_continue(:maybe_schedule_update, state) when not is_nil(state.ack_ref) do
    Logger.debug(
      "Waiting on update ack for #{length(state.ack_waiters)} shapes before scheduling new update"
    )

    {:noreply, state}
  end

  @empty_mapset MapSet.new()
  def handle_continue(:maybe_schedule_update, state)
      when map_size(state.to_add) == 0 and state.to_remove == @empty_mapset do
    Logger.debug("No shapes to register or unregister; skipping update scheduling")
    {:noreply, state}
  end

  def handle_continue(:maybe_schedule_update, state) do
    ack_ref =
      ShapeLogCollector.Processor.handle_shape_registration_updates(
        state.stack_id,
        state.to_add,
        state.to_remove
      )

    {:noreply,
     %{
       state
       | to_add: Map.new(),
         to_remove: MapSet.new(),
         to_schedule_waiters: [],
         ack_waiters: state.to_schedule_waiters,
         ack_ref: ack_ref
     }}
  end
end
