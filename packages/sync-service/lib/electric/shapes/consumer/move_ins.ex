defmodule Electric.Shapes.Consumer.MoveIns do
  alias Electric.Replication.Changes
  alias Electric.Replication.Changes.Transaction
  alias Electric.Postgres.Xid
  alias Electric.Postgres.SnapshotQuery

  defstruct waiting_move_ins: %{},
            filtering_move_ins: [],
            move_in_buffering_snapshot: nil

  @type pg_snapshot() :: SnapshotQuery.pg_snapshot()
  @type move_in_name() :: String.t()

  @type t() :: %__MODULE__{
          waiting_move_ins: %{move_in_name() => pg_snapshot()},
          filtering_move_ins: list({pg_snapshot(), keys :: list(String.t())}),
          move_in_buffering_snapshot: nil | pg_snapshot()
        }

  def new() do
    %__MODULE__{}
  end

  @doc """
  Add information about a new move-in to the state for which we're waiting
  and update the buffering boundary.
  """
  @spec add_waiting(t(), move_in_name(), pg_snapshot()) :: t()
  def add_waiting(%__MODULE__{waiting_move_ins: waiting_move_ins} = state, name, snapshot) do
    new_waiting_move_ins = Map.put(waiting_move_ins, name, snapshot)
    new_buffering_snapshot = make_move_in_buffering_snapshot(new_waiting_move_ins)

    %{
      state
      | waiting_move_ins: new_waiting_move_ins,
        move_in_buffering_snapshot: new_buffering_snapshot
    }
  end

  @spec make_move_in_buffering_snapshot(%{move_in_name() => pg_snapshot()}) :: nil | pg_snapshot()
  # The fake global snapshot allows us to check if a transaction is not visible in any of the pending snapshots
  # instead of checking each snapshot individually.
  defp make_move_in_buffering_snapshot(waiting_move_ins) when waiting_move_ins == %{}, do: nil

  defp make_move_in_buffering_snapshot(waiting_move_ins) do
    waiting_move_ins
    |> Map.values()
    |> Enum.reduce({:infinity, -1, []}, fn {xmin, xmax, xip_list},
                                           {global_xmin, global_xmax, global_xip_list} ->
      {Kernel.min(global_xmin, xmin), Kernel.max(global_xmax, xmax), global_xip_list ++ xip_list}
    end)
  end

  @doc """
  Change a move-in from "waiting" to "filtering" and update the buffering boundary.
  """
  @spec change_to_filtering(t(), move_in_name(), list(String.t())) :: t()
  def change_to_filtering(%__MODULE__{} = state, name, key_set) do
    {snapshot, waiting_move_ins} = Map.pop!(state.waiting_move_ins, name)
    filtering_move_ins = [{snapshot, key_set} | state.filtering_move_ins]
    buffering_snapshot = make_move_in_buffering_snapshot(waiting_move_ins)

    %{
      state
      | waiting_move_ins: waiting_move_ins,
        filtering_move_ins: filtering_move_ins,
        move_in_buffering_snapshot: buffering_snapshot
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
  Check if the transaction can be processed immediately or needs to be buffered.

  As a side effect, it also removes completed move-ins.
  """
  @spec check_txn(t(), Transaction.t()) :: {:continue, t()} | {:start_buffering, t()}
  def check_txn(%__MODULE__{move_in_buffering_snapshot: snapshot} = state, %Transaction{} = txn) do
    if is_nil(snapshot) or Transaction.visible_in_snapshot?(txn, snapshot) do
      state = remove_completed(state, txn)
      {:continue, state}
    else
      {:start_buffering, state}
    end
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
end
