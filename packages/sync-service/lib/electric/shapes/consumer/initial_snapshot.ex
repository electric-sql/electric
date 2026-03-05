defmodule Electric.Shapes.Consumer.InitialSnapshot do
  @moduledoc false
  # Internal module, used as a part of the consumer state, dealing
  # with the initial snapshot state and the waiting for the snapshot to start.
  alias Electric.Postgres.Xid
  alias Electric.Replication.Changes.Transaction
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.State

  defstruct filtering?: true,
            snapshot_started?: false,
            pg_snapshot: nil,
            awaiting_snapshot_start: []

  @type t() :: %__MODULE__{
          filtering?: boolean(),
          snapshot_started?: boolean(),
          pg_snapshot: nil | State.pg_snapshot(),
          awaiting_snapshot_start: list(GenServer.from())
        }

  @spec new(Storage.pg_snapshot() | nil) :: t()
  def new(nil), do: %__MODULE__{filtering?: true}

  def new(%{xmin: xmin, xmax: xmax, xip_list: xip_list} = snapshot) do
    %__MODULE__{
      filtering?: Map.get(snapshot, :filter_txns?, true),
      pg_snapshot: {xmin, xmax, xip_list}
    }
  end

  def add_waiter(%__MODULE__{} = state, from) do
    %{state | awaiting_snapshot_start: [from | state.awaiting_snapshot_start]}
  end

  def reply_to_waiters(%__MODULE__{} = state, reply) do
    for client <- List.wrap(state.awaiting_snapshot_start),
        not is_nil(client),
        do: GenServer.reply(client, reply)

    %{state | awaiting_snapshot_start: []}
  end

  def needs_buffering?(%__MODULE__{pg_snapshot: snapshot}), do: is_nil(snapshot)

  def maybe_stop_initial_filtering(%__MODULE__{} = state, storage, %Transaction{xid: xid}) do
    maybe_stop_initial_filtering(state, storage, xid)
  end

  def maybe_stop_initial_filtering(
        %__MODULE__{pg_snapshot: {xmin, xmax, xip_list} = snapshot} = state,
        storage,
        xid
      )
      when is_integer(xid) and xid > 0 do
    if Xid.after_snapshot?(xid, snapshot) do
      Storage.set_pg_snapshot(
        %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: false},
        storage
      )

      %{state | filtering?: false}
    else
      state
    end
  end

  @spec set_initial_snapshot(t(), Storage.shape_storage(), State.pg_snapshot()) :: t()
  def set_initial_snapshot(
        %__MODULE__{pg_snapshot: nil} = state,
        storage,
        {xmin, xmax, xip_list} = snapshot
      ) do
    # We're not changing snapshot storage format for backwards compatibility.
    Storage.set_pg_snapshot(
      %{xmin: xmin, xmax: xmax, xip_list: xip_list, filter_txns?: true},
      storage
    )

    %{state | pg_snapshot: snapshot, filtering?: true}
  end

  def mark_snapshot_started(
        %__MODULE__{snapshot_started?: true} = state,
        _stack_id,
        _shape_handle,
        _
      ),
      do: state

  def mark_snapshot_started(%__MODULE__{} = state, stack_id, shape_handle, storage) do
    Electric.Shapes.mark_snapshot_started(storage, stack_id, shape_handle)
    state = reply_to_waiters(state, :started)
    %{state | snapshot_started?: true}
  end

  def filter(state, storage, %Transaction{xid: xid}) do
    filter(state, storage, xid)
  end

  def filter(state, storage, xid) when is_integer(xid) and xid > 0 do
    if Transaction.visible_in_snapshot?(xid, state.pg_snapshot) do
      {:consider_flushed, state}
    else
      state = maybe_stop_initial_filtering(state, storage, xid)
      {:continue, state}
    end
  end
end
