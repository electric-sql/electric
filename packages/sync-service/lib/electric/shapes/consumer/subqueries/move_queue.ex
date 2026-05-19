defmodule Electric.Shapes.Consumer.Subqueries.MoveQueue do
  @moduledoc """
  Multi-dependency move queue. Tracks move_in/move_out operations per dependency index,
  with deduplication and redundancy elimination scoped per dependency.

  Move-outs from any dependency are drained before move-ins from any dependency.

  Each per-dep batch also accumulates the upstream Postgres transaction ids that
  contributed to it, so move-in/move-out broadcasts can carry `txids` for client
  attribution (mirroring `Electric.LogItems.from_change/4`).
  """

  @type move_value() :: {term(), term()}
  @type txid() :: pos_integer()
  @type entry() :: {[move_value()], MapSet.t(txid())}

  # move_out/move_in are maps from dep_index to {[move_value], MapSet<txid>}
  # to_times tracks the latest payload `to_time` seen per dep_index, so when
  # a queued batch is later popped we know what materializer logical time it
  # represents.
  defstruct move_out: %{}, move_in: %{}, to_times: %{}

  @type t() :: %__MODULE__{
          move_out: %{non_neg_integer() => entry()},
          move_in: %{non_neg_integer() => entry()},
          to_times: %{non_neg_integer() => non_neg_integer()}
        }

  @type batch_kind() :: :move_out | :move_in
  @type batch() :: {batch_kind(), non_neg_integer(), [move_value()], [txid()]}

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
  `dep_view` is the current view for this dependency, used for redundancy elimination.

  The payload may include a `:txids` key listing the upstream xids that produced
  the moves. Those xids are unioned with any already accumulated for this dep.
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
      to_times: to_times
    }
  end

  @doc """
  Pop the next batch of operations. Returns move-out batches (any dep) before move-in batches.
  Returns `{batch, to_time, updated_queue}` or `nil` if the queue is empty.
  `to_time` is the latest materializer logical time seen for this dep_index, or
  `nil` if the batch was enqueued without a `:to_time` key.
  """
  @spec pop_next(t()) :: {batch(), non_neg_integer() | nil, t()} | nil
  def pop_next(%__MODULE__{move_out: move_out} = queue) when move_out != %{} do
    {dep_index, {values, txids}} = Enum.min_by(move_out, &elem(&1, 0))
    to_time = Map.get(queue.to_times, dep_index)

    next_queue = %{queue | move_out: Map.delete(move_out, dep_index)}

    {{:move_out, dep_index, values, sorted_txids(txids)}, to_time,
     drop_to_time_if_dep_empty(next_queue, dep_index)}
  end

  def pop_next(%__MODULE__{move_out: move_out, move_in: move_in} = queue)
      when move_out == %{} and move_in != %{} do
    {dep_index, {values, txids}} = Enum.min_by(move_in, &elem(&1, 0))
    to_time = Map.get(queue.to_times, dep_index)

    next_queue = %{queue | move_in: Map.delete(move_in, dep_index)}

    {{:move_in, dep_index, values, sorted_txids(txids)}, to_time,
     drop_to_time_if_dep_empty(next_queue, dep_index)}
  end

  def pop_next(%__MODULE__{}), do: nil

  defp drop_to_time_if_dep_empty(%__MODULE__{} = queue, dep_index) do
    if Map.has_key?(queue.move_out, dep_index) or Map.has_key?(queue.move_in, dep_index) do
      queue
    else
      %{queue | to_times: Map.delete(queue.to_times, dep_index)}
    end
  end

  defp sorted_txids(%MapSet{} = txids), do: Enum.sort(txids)

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
