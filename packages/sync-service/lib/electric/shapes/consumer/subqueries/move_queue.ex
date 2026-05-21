defmodule Electric.Shapes.Consumer.Subqueries.MoveQueue do
  @moduledoc """
  Multi-dependency move queue. Tracks move_in/move_out operations per
  dependency index, with deduplication and redundancy elimination scoped
  per dependency via `reduce/2`.

  Each `pop_next/1` call returns ONE combined entry for a single dep that
  carries both `move_in_values` and `move_out_values`, along with the
  `from_time` (the materializer logical time the consumer was at when the
  first payload in this batch was enqueued) and `to_time` (the max of all
  payload `to_time`s queued for this dep). The combined shape lets the
  splice plan handle a dep's full transition window as one atomic
  ActiveMove — `MTV(from_time)` and `MTV(to_time)` are well-defined
  endpoints, and `MTV(to_time) = MTV(from_time) + move_in_values
  - move_out_values` by construction of the reduce.

  Per-dep txids are accumulated across the contributing payloads so the
  broadcasts can carry `txids` for client attribution.
  """

  @type move_value() :: {term(), term()}
  @type txid() :: pos_integer()
  @type entry() :: {[move_value()], MapSet.t(txid())}

  defstruct move_out: %{}, move_in: %{}, from_times: %{}, to_times: %{}

  @type t() :: %__MODULE__{
          move_out: %{non_neg_integer() => entry()},
          move_in: %{non_neg_integer() => entry()},
          from_times: %{non_neg_integer() => non_neg_integer()},
          to_times: %{non_neg_integer() => non_neg_integer()}
        }

  @type combined_batch() :: %{
          dep_index: non_neg_integer(),
          move_in_values: [move_value()],
          move_out_values: [move_value()],
          from_time: non_neg_integer() | nil,
          to_time: non_neg_integer() | nil,
          txids: [txid()]
        }

  @spec new() :: t()
  def new, do: %__MODULE__{}

  @spec length(t()) :: non_neg_integer()
  def length(%__MODULE__{move_out: move_out, move_in: move_in}) do
    count_values(move_out) + count_values(move_in)
  end

  defp count_values(map) do
    Enum.reduce(map, 0, fn {_, {vs, _}}, acc -> acc + Kernel.length(vs) end)
  end

  @doc """
  Enqueue a materializer payload for a specific dependency.

  `dep_view` is the materializer view at the consumer's pinned time for
  this dep (or the view-after-active-move for the trigger ref during
  Buffering). It's used by `reduce/2` to drop redundant ops.

  The payload may include `:from_time`, `:to_time`, and `:txids` keys.
  The first enqueue for a dep records `from_time` (subsequent payloads
  leave it untouched). `to_time` is updated to `max(current, new)`. Txids
  accumulate.
  """
  @spec enqueue(t(), non_neg_integer(), map() | keyword(), MapSet.t()) :: t()
  def enqueue(%__MODULE__{} = queue, dep_index, payload, %MapSet{} = dep_view)
      when is_map(payload) or is_list(payload) do
    payload = Map.new(payload)
    new_txids = payload |> Map.get(:txids, []) |> MapSet.new()

    {existing_outs, existing_out_txids} = Map.get(queue.move_out, dep_index, {[], MapSet.new()})
    {existing_ins, existing_in_txids} = Map.get(queue.move_in, dep_index, {[], MapSet.new()})

    ops =
      Enum.map(existing_outs, &{:move_out, &1}) ++
        Enum.map(existing_ins, &{:move_in, &1}) ++
        payload_to_ops(payload)

    {new_outs, new_ins} = reduce(ops, dep_view)

    from_times =
      case Map.get(payload, :from_time) do
        nil -> queue.from_times
        new_from_time -> Map.put_new(queue.from_times, dep_index, new_from_time)
      end

    to_times =
      case Map.get(payload, :to_time) do
        nil -> queue.to_times
        new_to_time -> Map.update(queue.to_times, dep_index, new_to_time, &max(&1, new_to_time))
      end

    %__MODULE__{
      move_out:
        put_or_delete(
          queue.move_out,
          dep_index,
          new_outs,
          MapSet.union(existing_out_txids, new_txids)
        ),
      move_in:
        put_or_delete(
          queue.move_in,
          dep_index,
          new_ins,
          MapSet.union(existing_in_txids, new_txids)
        ),
      from_times: from_times,
      to_times: to_times
    }
  end

  @doc """
  Pop the next combined entry for one dep. Returns `{batch, updated_queue}`
  where `batch` carries both `move_in_values` and `move_out_values` (either
  may be empty, but not both — empty entries are never enqueued). Returns
  `nil` if the queue is empty.
  """
  @spec pop_next(t()) :: {combined_batch(), t()} | nil
  def pop_next(%__MODULE__{move_in: move_in, move_out: move_out})
      when move_in == %{} and move_out == %{},
      do: nil

  def pop_next(%__MODULE__{} = queue) do
    dep_index = pick_dep_index(queue)

    {move_in_values, in_txids} = Map.get(queue.move_in, dep_index, {[], MapSet.new()})
    {move_out_values, out_txids} = Map.get(queue.move_out, dep_index, {[], MapSet.new()})
    txids = MapSet.union(in_txids, out_txids) |> Enum.sort()

    batch = %{
      dep_index: dep_index,
      move_in_values: move_in_values,
      move_out_values: move_out_values,
      from_time: Map.get(queue.from_times, dep_index),
      to_time: Map.get(queue.to_times, dep_index),
      txids: txids
    }

    next_queue = %__MODULE__{
      move_in: Map.delete(queue.move_in, dep_index),
      move_out: Map.delete(queue.move_out, dep_index),
      from_times: Map.delete(queue.from_times, dep_index),
      to_times: Map.delete(queue.to_times, dep_index)
    }

    {batch, next_queue}
  end

  defp pick_dep_index(%__MODULE__{move_in: move_in, move_out: move_out}) do
    candidates = Map.keys(move_in) ++ Map.keys(move_out)
    Enum.min(candidates)
  end

  defp payload_to_ops(payload) do
    Enum.map(Map.get(payload, :move_out, []), &{:move_out, &1}) ++
      Enum.map(Map.get(payload, :move_in, []), &{:move_in, &1})
  end

  defp reduce(ops, base_view) do
    terminal_ops =
      ops
      |> Enum.with_index()
      |> Enum.reduce(%{}, fn {{kind, move_value}, index}, acc ->
        Map.put(acc, elem(move_value, 0), %{kind: kind, move_value: move_value, index: index})
      end)
      |> Map.values()
      |> Enum.reject(&redundant?(&1, base_view))
      |> Enum.sort_by(& &1.index)

    {
      for(%{kind: :move_out, move_value: move_value} <- terminal_ops, do: move_value),
      for(%{kind: :move_in, move_value: move_value} <- terminal_ops, do: move_value)
    }
  end

  defp redundant?(%{kind: :move_in, move_value: {value, _}}, base_view) do
    MapSet.member?(base_view, value)
  end

  defp redundant?(%{kind: :move_out, move_value: {value, _}}, base_view) do
    not MapSet.member?(base_view, value)
  end

  defp put_or_delete(map, key, [], _txids), do: Map.delete(map, key)
  defp put_or_delete(map, key, values, txids), do: Map.put(map, key, {values, txids})
end
