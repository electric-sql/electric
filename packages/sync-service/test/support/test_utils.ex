defmodule Support.TestUtils do
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.LogChunker
  alias Electric.LogItems
  alias Electric.Replication.Changes

  @doc """
  Preprocess a list of `Changes.data_change()` structs in the same way they
  are preprocessed before reaching storage.
  """
  def changes_to_log_items(changes, opts \\ []) do
    pk = Keyword.get(opts, :pk, ["id"])
    xid = Keyword.get(opts, :xid, 1)
    replica = Keyword.get(opts, :replica, :default)
    chunk_size = Keyword.get(opts, :chunk_size, LogChunker.default_chunk_size_threshold())

    changes
    |> Enum.map(&Changes.fill_key(&1, pk))
    |> Enum.flat_map(&LogItems.from_change(&1, xid, pk, replica))
    |> Enum.map(fn item ->
      {item.offset, item.key, item.headers.operation, Jason.encode!(item)}
    end)
    |> Enum.flat_map_reduce(0, fn {offset, _, _, json_log_item} = line, acc ->
      case LogChunker.fit_into_chunk(byte_size(json_log_item), acc, chunk_size) do
        {:ok, new_chunk_size} ->
          {[line], new_chunk_size}

        {:threshold_exceeded, new_chunk_size} ->
          {[line, {:chunk_boundary, offset}], new_chunk_size}
      end
    end)
    |> elem(0)
  end

  def with_electric_instance_id(ctx) do
    %{electric_instance_id: String.to_atom(full_test_name(ctx))}
  end

  def full_test_name(ctx) do
    "#{ctx.module} #{ctx.test}"
  end

  def ins(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})
    record = Keyword.fetch!(opts, :rec) |> Map.new(fn {k, v} -> {to_string(k), to_string(v)} end)
    %Changes.NewRecord{relation: relation, record: record, log_offset: offset}
  end

  def del(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    old_record =
      Keyword.fetch!(opts, :rec) |> Map.new(fn {k, v} -> {to_string(k), to_string(v)} end)

    %Changes.DeletedRecord{relation: relation, old_record: old_record, log_offset: offset}
  end

  def upd(opts) do
    offset = Keyword.fetch!(opts, :offset) |> LogOffset.new()
    relation = Keyword.get(opts, :relation, {"public", "test_table"})

    {old, new} =
      Enum.reduce(Keyword.fetch!(opts, :rec), {%{}, %{}}, fn
        {k, {old, new}}, {old_acc, new_acc} ->
          {Map.put(old_acc, to_string(k), to_string(old)),
           Map.put(new_acc, to_string(k), to_string(new))}

        {k, v}, {old, new} ->
          {Map.put(old, to_string(k), to_string(v)), Map.put(new, to_string(k), to_string(v))}
      end)

    Changes.UpdatedRecord.new(
      relation: relation,
      old_record: old,
      record: new,
      log_offset: offset
    )
  end
end
