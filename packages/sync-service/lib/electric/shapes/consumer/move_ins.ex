defmodule Electric.Shapes.Consumer.MoveIns do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Xid
  alias Electric.Postgres.SnapshotQuery

  require Xid

  defstruct waiting_move_ins: %{},
            filtering_move_ins: [],
            touch_tracker: %{},
            move_in_buffering_snapshot: nil,
            in_flight_values: %{}

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type move_in_name() :: String.t()
  @type in_flight_values() :: %{term() => MapSet.t()}
  @type t() :: %__MODULE__{
          waiting_move_ins: %{move_in_name() => {pg_snapshot(), {term(), MapSet.t()}}},
          filtering_move_ins: list({pg_snapshot(), keys :: list(String.t())}),
          touch_tracker: %{String.t() => pos_integer()},
          move_in_buffering_snapshot: nil | pg_snapshot(),
          in_flight_values: in_flight_values()
        }
  def new() do
    %__MODULE__{}
  end

  @doc """
  Add information about a new move-in to the state for which we're waiting.
  Snapshot can be nil initially and will be set later when the query begins.
  """
  @spec add_waiting(t(), move_in_name(), pg_snapshot() | nil, {term(), MapSet.t()}) :: t()
  def add_waiting(
        %__MODULE__{waiting_move_ins: waiting_move_ins} = state,
        name,
        snapshot,
        moved_values
      ) do
    new_waiting_move_ins = Map.put(waiting_move_ins, name, {snapshot, moved_values})
    new_buffering_snapshot = make_move_in_buffering_snapshot(new_waiting_move_ins)

    %{
      state
      | waiting_move_ins: new_waiting_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot,
        in_flight_values: make_in_flight_values(new_waiting_move_ins)
    }
  end

  @doc """
  Set the snapshot for a waiting move-in when it becomes known.
  """
  @spec set_snapshot(t(), move_in_name(), pg_snapshot()) :: t()
  def set_snapshot(%__MODULE__{waiting_move_ins: waiting_move_ins} = state, name, snapshot) do
    new_move_ins =
      Map.update!(waiting_move_ins, name, fn {_, moved_values} -> {snapshot, moved_values} end)

    new_buffering_snapshot = make_move_in_buffering_snapshot(new_move_ins)

    %{
      state
      | waiting_move_ins: new_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot
    }
  end

  @spec make_move_in_buffering_snapshot(%{move_in_name() => pg_snapshot()}) :: nil | pg_snapshot()
  # The fake global snapshot allows us to check if a transaction is not visible in any of the pending snapshots
  # instead of checking each snapshot individually.
  defp make_move_in_buffering_snapshot(waiting_move_ins) when waiting_move_ins == %{}, do: nil

  defp make_move_in_buffering_snapshot(waiting_move_ins) do
    snapshots =
      waiting_move_ins
      |> Map.values()
      |> Enum.map(fn {snapshot, _} -> snapshot end)
      |> Enum.reject(&is_nil/1)

    case snapshots do
      [] ->
        nil

      _ ->
        Enum.reduce(snapshots, {:infinity, -1, []}, fn {xmin, xmax, xip_list},
                                                       {global_xmin, global_xmax, global_xip_list} ->
          {Kernel.min(global_xmin, xmin), Kernel.max(global_xmax, xmax),
           global_xip_list ++ xip_list}
        end)
    end
  end

  defp make_in_flight_values(waiting_move_ins) do
    waiting_move_ins
    |> Map.values()
    |> Enum.map(fn {_, moved_values} -> moved_values end)
    |> Enum.reduce(%{}, fn {key, value}, acc ->
      Map.update(acc, key, value, &MapSet.union(&1, value))
    end)
  end

  @doc """
  Change a move-in from "waiting" to "filtering".
  """
  @spec change_to_filtering(t(), move_in_name(), MapSet.t(String.t())) :: t()
  def change_to_filtering(%__MODULE__{} = state, name, key_set) do
    {{snapshot, _}, waiting_move_ins} = Map.pop!(state.waiting_move_ins, name)
    filtering_move_ins = [{snapshot, key_set} | state.filtering_move_ins]
    buffering_snapshot = make_move_in_buffering_snapshot(waiting_move_ins)

    %{
      state
      | waiting_move_ins: waiting_move_ins,
        filtering_move_ins: filtering_move_ins,
        move_in_buffering_snapshot: buffering_snapshot,
        in_flight_values: make_in_flight_values(waiting_move_ins)
    }
  end

  @doc """
  Remove completed move-ins from the state.

  Move-in is considered "completed" (i.e. not included in the filtering logic)
  once we see any transaction that is after the end of the move-in snapshot.

  Filtering generally is applied only to transactions that are already visible
  in the snapshot, and those can only be with `xid < xmax`.
  """
  @spec remove_completed(t(), Transaction.t()) :: t()
  def remove_completed(%__MODULE__{} = state, %Transaction{xid: xid}) do
    state.filtering_move_ins
    |> Enum.reject(fn {snapshot, _} -> Xid.after_snapshot?(xid, snapshot) end)
    |> then(&%{state | filtering_move_ins: &1})
  end

  @doc """
  Check if a change is already visible in one of the completed move-ins.

  A visible change means it needs to be skipped to avoid duplicates.
  """
  @spec change_already_visible?(t(), Xid.anyxid(), Changes.change()) :: boolean()
  def change_already_visible?(_state, _xid, %Changes.DeletedRecord{}), do: false
  def change_already_visible?(%__MODULE__{filtering_move_ins: []}, _, _), do: false

  def change_already_visible?(%__MODULE__{filtering_move_ins: filters}, xid, %{key: key}) do
    Enum.any?(filters, fn {snapshot, key_set} ->
      Transaction.visible_in_snapshot?(xid, snapshot) and MapSet.member?(key_set, key)
    end)
  end

  @doc """
  Track a touch for a non-delete change.
  Returns updated touch_tracker.
  """
  @spec track_touch(t(), pos_integer(), Changes.change()) :: t()

  def track_touch(%__MODULE__{} = state, _xid, %Changes.DeletedRecord{}),
    do: state

  def track_touch(%__MODULE__{touch_tracker: touch_tracker} = state, xid, %{key: key}) do
    %{state | touch_tracker: Map.put(touch_tracker, key, xid)}
  end

  @doc """
  Garbage collect touches that are visible in all pending snapshots.
  A touch is visible if its xid is before the minimum xmin of all waiting snapshots.
  """
  @spec gc_touch_tracker(t()) :: t()
  def gc_touch_tracker(
        %__MODULE__{
          move_in_buffering_snapshot: nil,
          waiting_move_ins: waiting_move_ins
        } = state
      ) do
    # If there are waiting move-ins but buffering_snapshot is nil (all snapshots unknown),
    # keep all touches. Otherwise (no waiting move-ins), clear all touches.
    case waiting_move_ins do
      empty when empty == %{} -> %{state | touch_tracker: %{}}
      _ -> state
    end
  end

  def gc_touch_tracker(
        %__MODULE__{
          touch_tracker: touch_tracker,
          move_in_buffering_snapshot: {xmin, _xmax, _xip_list}
        } =
          state
      ) do
    # Remove touches that are before the minimum xmin (visible in all snapshots)
    %{
      state
      | touch_tracker:
          Map.reject(touch_tracker, fn {_key, touch_xid} ->
            touch_xid < xmin
          end)
    }
  end

  @doc """
  Check if a query result row should be skipped because a fresher version exists in the stream.
  Skip if: touch exists AND touch xid is NOT visible in query snapshot.
  """
  @spec should_skip_query_row?(%{String.t() => pos_integer()}, pg_snapshot(), String.t()) ::
          boolean()
  def should_skip_query_row?(touch_tracker, _snapshot, key)
      when not is_map_key(touch_tracker, key) do
    false
  end

  def should_skip_query_row?(touch_tracker, snapshot, key) do
    touch_xid = Map.fetch!(touch_tracker, key)
    # Skip if touch is NOT visible in snapshot (means we have fresher data in stream)
    not Transaction.visible_in_snapshot?(touch_xid, snapshot)
  end
end
