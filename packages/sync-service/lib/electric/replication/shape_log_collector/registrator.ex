defmodule Electric.Replication.ShapeLogCollector.Registrator do
  @moduledoc """
  Module responsible for registering and unregistering shapes
  with the ShapeLogCollector. It batches registration and
  unregistration requests to avoid overwhelming the ShapeLogCollector
  with frequent updates.

  The current implementation batches updates until it receives an
  acknowledgement that its previous update was processed by the Processor,
  and only then sends the next batch of updates. This is slower than a
  regular debounce, but prevents any buildup on the Processor.

  In the future, this could also create diffs to the shape filters
  instead of sending the full list of shapes to add/remove on each update.
  """
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

  @type t :: %__MODULE__{
          stack_id: Electric.stack_id(),
          to_add: %{Electric.shape_handle() => Electric.Shapes.Shape.t()},
          to_remove: MapSet.t(Electric.shape_handle()),
          to_schedule_waiters: %{Electric.shape_handle() => GenServer.from() | nil},
          ack_waiters: [{Electric.shape_handle(), GenServer.from()}],
          ack_ref: reference() | nil
        }

  @spec name(Electric.stack_id()) :: GenServer.name()
  def name(stack_id) when is_stack_id(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  @doc """
  Registers a shape with the SLC, returns after the shape has actually
  been added and is receiving operations from the log.
  """
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

  @doc """
  Schedules a shape removal from the SLC, returns before the shape is
  actually removed.
  """
  @spec unsubscribe(Electric.stack_id(), Electric.shape_handle()) :: :ok
  def unsubscribe(stack_id, shape_handle) do
    GenServer.call(name(stack_id), {:remove_shape, shape_handle})
  end

  @doc """
  Handles the response from the Processor acknowledging a registration update.
  """
  @spec handle_processor_update_response(
          Electric.stack_id(),
          reference(),
          %{optional(Electric.shape_handle()) => :ok | {:error, String.t()}}
        ) :: :ok
  def handle_processor_update_response(stack_id, ref, results) do
    GenServer.cast(name(stack_id), {:handle_processor_update_response, ref, results})
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
       to_schedule_waiters: %{},
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
         to_schedule_waiters: Map.put(state.to_schedule_waiters, shape_handle, from)
     }, {:continue, :maybe_schedule_update}}
  end

  def handle_call({:remove_shape, shape_handle}, _from, state) do
    if from = Map.get(state.to_schedule_waiters, shape_handle) do
      GenServer.reply(
        from,
        {:error, "Shape #{shape_handle} removed before registration completed"}
      )
    end

    # This has to return before the shape is actually removed, otherwise the system will deadlock:
    # - a consumer being cleanly shutdown may be waiting for a response from ShapeLogCollector
    #   while ShapeLogCollector is waiting for an ack from a transaction event, or
    # - a consumer that has crashed will be waiting in a terminate callback
    #   for a reply from the unsubscribe while the ShapeLogCollector is again
    #   waiting for a txn ack.
    {:reply, :ok,
     %{
       state
       | to_add: Map.delete(state.to_add, shape_handle),
         to_remove: MapSet.put(state.to_remove, shape_handle),
         to_schedule_waiters: Map.put(state.to_schedule_waiters, shape_handle, nil)
     }, {:continue, :maybe_schedule_update}}
  end

  @impl true
  def handle_cast(
        {:handle_processor_update_response, ref, results},
        %{ack_ref: ref} = state
      ) do
    for {shape_handle, from} <- state.ack_waiters do
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

  def handle_continue(:maybe_schedule_update, state)
      when map_size(state.to_schedule_waiters) == 0 do
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

    ack_waiters = state.to_schedule_waiters |> Enum.to_list() |> List.keydelete(nil, 1)

    {:noreply,
     %{
       state
       | to_add: Map.new(),
         to_remove: MapSet.new(),
         to_schedule_waiters: %{},
         ack_waiters: ack_waiters,
         ack_ref: ack_ref
     }}
  end
end
