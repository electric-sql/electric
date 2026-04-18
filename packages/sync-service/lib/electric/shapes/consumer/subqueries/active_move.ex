defmodule Electric.Shapes.Consumer.Subqueries.ActiveMove do
  # Tracks a single buffered move-in while we wait to splice it into the log.

  alias Electric.Postgres.Lsn
  alias Electric.Replication.Changes.Transaction
  alias Electric.Shapes.Consumer.Subqueries.Views

  @type move_value() :: {term(), term()}

  @enforce_keys [
    :dep_index,
    :dep_move_kind,
    :subquery_ref,
    :values,
    :views_before_move,
    :views_after_move
  ]
  defstruct [
    :dep_index,
    :dep_move_kind,
    :subquery_ref,
    :values,
    :views_before_move,
    :views_after_move,
    snapshot: nil,
    move_in_snapshot_name: nil,
    move_in_row_count: nil,
    move_in_row_bytes: nil,
    move_in_lsn: nil,
    latest_seen_lsn: nil,
    boundary_txn_count: nil,
    buffered_txn_count: 0,
    buffered_txns: []
  ]

  @type t() :: %__MODULE__{
          dep_index: non_neg_integer(),
          dep_move_kind: :move_in | :move_out,
          subquery_ref: [String.t()],
          values: [move_value()],
          views_before_move: Views.t(),
          views_after_move: Views.t(),
          snapshot: {term(), term(), [term()]} | nil,
          move_in_snapshot_name: String.t() | nil,
          move_in_row_count: non_neg_integer() | nil,
          move_in_row_bytes: non_neg_integer() | nil,
          move_in_lsn: Lsn.t() | nil,
          latest_seen_lsn: Lsn.t() | nil,
          boundary_txn_count: non_neg_integer() | nil,
          buffered_txn_count: non_neg_integer(),
          buffered_txns: [Transaction.t()]
        }

  @spec start(Views.t(), non_neg_integer(), :move_in | :move_out, [String.t()], [move_value()]) ::
          t()
  def start(views, dep_index, dep_move_kind, subquery_ref, values) when is_map(views) do
    %__MODULE__{
      dep_index: dep_index,
      dep_move_kind: dep_move_kind,
      subquery_ref: subquery_ref,
      values: values,
      views_before_move: views,
      views_after_move: Views.apply_move(views, subquery_ref, values, dep_move_kind)
    }
  end

  @spec buffer_txn(t(), Transaction.t()) :: t()
  def buffer_txn(%__MODULE__{} = active_move, %Transaction{} = txn) do
    active_move
    |> maybe_set_boundary_from_txn(txn)
    |> Map.update!(:buffered_txns, &[txn | &1])
    |> Map.update!(:buffered_txn_count, &(&1 + 1))
  end

  @spec buffered_txn_count(t()) :: non_neg_integer()
  def buffered_txn_count(%__MODULE__{buffered_txn_count: buffered_txn_count}),
    do: buffered_txn_count

  @spec record_seen_lsn(t(), Lsn.t()) :: t()
  def record_seen_lsn(%__MODULE__{} = active_move, %Lsn{} = lsn) do
    latest_seen_lsn = newer_lsn(active_move.latest_seen_lsn, lsn)

    active_move
    |> Map.put(:latest_seen_lsn, latest_seen_lsn)
    |> maybe_set_boundary_from_lsn(latest_seen_lsn)
  end

  @spec carry_latest_seen_lsn(t(), Lsn.t() | nil) :: t()
  def carry_latest_seen_lsn(%__MODULE__{} = active_move, %Lsn{} = latest_seen_lsn) do
    %{active_move | latest_seen_lsn: latest_seen_lsn}
  end

  def carry_latest_seen_lsn(%__MODULE__{} = active_move, _latest_seen_lsn), do: active_move

  @spec record_snapshot!(t(), {term(), term(), [term()]}) :: t()
  def record_snapshot!(%__MODULE__{snapshot: nil} = active_move, snapshot) do
    active_move
    |> Map.put(:snapshot, snapshot)
    |> maybe_set_boundary_from_snapshot()
  end

  def record_snapshot!(%__MODULE__{}, _snapshot) do
    raise ArgumentError, "received {:pg_snapshot_known, snapshot} more than once for one move-in"
  end

  @spec record_query_complete!(t(), String.t(), non_neg_integer(), non_neg_integer(), Lsn.t()) ::
          t()
  def record_query_complete!(
        %__MODULE__{move_in_snapshot_name: nil} = active_move,
        snapshot_name,
        row_count,
        row_bytes,
        move_in_lsn
      ) do
    active_move
    |> Map.put(:move_in_snapshot_name, snapshot_name)
    |> Map.put(:move_in_row_count, row_count)
    |> Map.put(:move_in_row_bytes, row_bytes)
    |> Map.put(:move_in_lsn, move_in_lsn)
    |> maybe_set_boundary_from_seen_lsn()
  end

  def record_query_complete!(%__MODULE__{}, _snapshot_name, _row_count, _row_bytes, _move_in_lsn) do
    raise ArgumentError,
          "received {:query_move_in_complete, snapshot_name, row_count, row_bytes, move_in_lsn} more than once for one move-in"
  end

  @spec ready_to_splice?(t()) :: boolean()
  def ready_to_splice?(%__MODULE__{} = active_move) do
    not is_nil(active_move.snapshot) and not is_nil(active_move.move_in_snapshot_name) and
      not is_nil(active_move.boundary_txn_count)
  end

  @spec split_buffer(t()) :: {[Transaction.t()], [Transaction.t()]}
  def split_buffer(%__MODULE__{} = active_move) do
    active_move.buffered_txns
    |> Enum.reverse()
    |> Enum.split(active_move.boundary_txn_count)
  end

  @spec last_buffered_log_offset(t()) :: Electric.Replication.LogOffset.t() | nil
  def last_buffered_log_offset(%__MODULE__{buffered_txns: []}), do: nil

  def last_buffered_log_offset(%__MODULE__{
        buffered_txns: [%Transaction{last_log_offset: log_offset} | _]
      }),
      do: log_offset

  defp maybe_set_boundary_from_txn(
         %__MODULE__{boundary_txn_count: boundary} = active_move,
         _txn
       )
       when not is_nil(boundary),
       do: active_move

  defp maybe_set_boundary_from_txn(%__MODULE__{snapshot: nil} = active_move, _txn),
    do: active_move

  defp maybe_set_boundary_from_txn(%__MODULE__{} = active_move, %Transaction{} = txn) do
    if Transaction.visible_in_snapshot?(txn, active_move.snapshot) do
      active_move
    else
      %{active_move | boundary_txn_count: active_move.buffered_txn_count}
    end
  end

  defp maybe_set_boundary_from_snapshot(%__MODULE__{boundary_txn_count: boundary} = active_move)
       when not is_nil(boundary),
       do: active_move

  defp maybe_set_boundary_from_snapshot(%__MODULE__{snapshot: nil} = active_move),
    do: active_move

  defp maybe_set_boundary_from_snapshot(%__MODULE__{} = active_move) do
    case active_move.buffered_txns
         |> Enum.reverse()
         |> Enum.find_index(&(not Transaction.visible_in_snapshot?(&1, active_move.snapshot))) do
      nil -> active_move
      index -> %{active_move | boundary_txn_count: index}
    end
  end

  defp maybe_set_boundary_from_lsn(
         %__MODULE__{boundary_txn_count: boundary} = active_move,
         _lsn
       )
       when not is_nil(boundary),
       do: active_move

  defp maybe_set_boundary_from_lsn(%__MODULE__{move_in_lsn: nil} = active_move, _lsn),
    do: active_move

  defp maybe_set_boundary_from_lsn(%__MODULE__{} = active_move, %Lsn{} = lsn) do
    case Lsn.compare(lsn, active_move.move_in_lsn) do
      :lt -> active_move
      _ -> %{active_move | boundary_txn_count: active_move.buffered_txn_count}
    end
  end

  defp maybe_set_boundary_from_seen_lsn(%__MODULE__{latest_seen_lsn: nil} = active_move),
    do: active_move

  defp maybe_set_boundary_from_seen_lsn(%__MODULE__{} = active_move) do
    maybe_set_boundary_from_lsn(active_move, active_move.latest_seen_lsn)
  end

  defp newer_lsn(nil, %Lsn{} = lsn), do: lsn

  defp newer_lsn(%Lsn{} = current, %Lsn{} = candidate) do
    case Lsn.compare(current, candidate) do
      :lt -> candidate
      _ -> current
    end
  end
end
