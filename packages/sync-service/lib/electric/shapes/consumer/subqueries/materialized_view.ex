defmodule Electric.Shapes.Consumer.Subqueries.MaterializedView do
  @moduledoc false

  alias Electric.Replication.Changes
  alias Electric.Replication.Eval
  alias Electric.Utils

  @enforce_keys [:dependency_handle, :columns, :materialized_type]
  defstruct [
    :dependency_handle,
    :columns,
    :materialized_type,
    rows_by_key: %{},
    value_counts: %{},
    tag_indices: %{}
  ]

  @type t() :: %__MODULE__{
          dependency_handle: String.t(),
          columns: [String.t()],
          materialized_type: {:array, term()},
          rows_by_key: %{optional(String.t()) => term()},
          value_counts: %{optional(term()) => pos_integer()},
          tag_indices: %{optional(String.t()) => MapSet.t(String.t())}
        }

  @spec new(keyword() | map()) :: t()
  def new(opts) when is_list(opts) or is_map(opts) do
    opts = Map.new(opts)

    %__MODULE__{
      dependency_handle: fetch_opt!(opts, :dependency_handle),
      columns: fetch_opt!(opts, :columns),
      materialized_type: fetch_opt!(opts, :materialized_type)
    }
  end

  @spec handle_changes(t(), [term()]) :: {{:materializer_changes, String.t(), map()} | nil, t()}
  def handle_changes(%__MODULE__{} = state, changes) do
    {state, events} = apply_changes(state, changes)
    events = events |> cancel_matching_move_events() |> drop_empty_event_keys()

    event =
      case events do
        events when events == %{} -> nil
        payload -> {:materializer_changes, state.dependency_handle, payload}
      end

    {event, state}
  end

  @spec values(t()) :: MapSet.t()
  def values(%__MODULE__{value_counts: value_counts}) do
    MapSet.new(Map.keys(value_counts))
  end

  defp apply_changes(state, changes) do
    {state, events} =
      Enum.reduce(changes, {state, []}, fn change, {state, events} ->
        apply_change(state, change, events)
      end)

    {state, Enum.group_by(events, &elem(&1, 0), &elem(&1, 1))}
  end

  defp apply_change(
         state,
         %Changes.NewRecord{key: key, record: record, move_tags: move_tags},
         events
       ) do
    {value, original_string} = cast!(record, state)

    if is_map_key(state.rows_by_key, key), do: raise("Key #{key} already exists")

    state = %{
      state
      | rows_by_key: Map.put(state.rows_by_key, key, value),
        tag_indices: add_row_to_tag_indices(state.tag_indices, key, move_tags)
    }

    {value_counts, events} = increment_value(events, state.value_counts, value, original_string)
    {%{state | value_counts: value_counts}, events}
  end

  defp apply_change(
         state,
         %Changes.UpdatedRecord{
           key: key,
           record: record,
           move_tags: move_tags,
           removed_move_tags: removed_move_tags
         },
         events
       ) do
    columns_present = Enum.any?(state.columns, &is_map_key(record, &1))
    has_tag_updates = removed_move_tags != []

    if columns_present or has_tag_updates do
      tag_indices =
        state.tag_indices
        |> remove_row_from_tag_indices(key, removed_move_tags)
        |> add_row_to_tag_indices(key, move_tags)

      state = %{state | tag_indices: tag_indices}

      if columns_present do
        {value, original_string} = cast!(record, state)
        old_value = Map.fetch!(state.rows_by_key, key)
        state = %{state | rows_by_key: Map.put(state.rows_by_key, key, value)}

        if old_value == value do
          {state, events}
        else
          {value_counts, events} =
            decrement_value(
              events,
              state.value_counts,
              old_value,
              value_to_string(old_value, state)
            )

          {value_counts, events} = increment_value(events, value_counts, value, original_string)
          {%{state | value_counts: value_counts}, events}
        end
      else
        {state, events}
      end
    else
      {state, events}
    end
  end

  defp apply_change(state, %Changes.DeletedRecord{key: key, move_tags: move_tags}, events) do
    {value, rows_by_key} = Map.pop!(state.rows_by_key, key)

    state = %{
      state
      | rows_by_key: rows_by_key,
        tag_indices: remove_row_from_tag_indices(state.tag_indices, key, move_tags)
    }

    {value_counts, events} =
      decrement_value(events, state.value_counts, value, value_to_string(value, state))

    {%{state | value_counts: value_counts}, events}
  end

  defp apply_change(state, %{headers: %{event: "move-out", patterns: patterns}}, events) do
    {keys, tag_indices} = pop_keys_from_tag_indices(state.tag_indices, patterns)

    {rows_by_key, value_counts, events} =
      Enum.reduce(keys, {state.rows_by_key, state.value_counts, events}, fn key,
                                                                            {rows_by_key,
                                                                             value_counts, events} ->
        {value, rows_by_key} = Map.pop!(rows_by_key, key)

        {value_counts, events} =
          decrement_value(events, value_counts, value, value_to_string(value, state))

        {rows_by_key, value_counts, events}
      end)

    {%{state | rows_by_key: rows_by_key, value_counts: value_counts, tag_indices: tag_indices},
     events}
  end

  defp cast!(record, %{columns: columns, materialized_type: {:array, {:row, types}}}) do
    original_strings = Enum.map(columns, &Map.fetch!(record, &1))

    {:ok, values} =
      Enum.zip(original_strings, types)
      |> Utils.map_while_ok(fn {const, type} ->
        Eval.Env.parse_const(Eval.Env.new(), const, type)
      end)

    {List.to_tuple(values), List.to_tuple(original_strings)}
  end

  defp cast!(record, %{columns: [column], materialized_type: {:array, type}}) do
    original_string = Map.fetch!(record, column)
    {:ok, value} = Eval.Env.parse_const(Eval.Env.new(), original_string, type)
    {value, original_string}
  end

  defp value_to_string(value, %{materialized_type: {:array, {:row, type}}}) do
    value
    |> Tuple.to_list()
    |> Enum.zip_with(type, &Eval.Env.const_to_pg_string(Eval.Env.new(), &1, &2))
    |> List.to_tuple()
  end

  defp value_to_string(value, %{materialized_type: {:array, type}}) do
    Eval.Env.const_to_pg_string(Eval.Env.new(), value, type)
  end

  defp increment_value(events, value_counts, value, original_string) do
    case Map.fetch(value_counts, value) do
      {:ok, count} -> {Map.put(value_counts, value, count + 1), events}
      :error -> {Map.put(value_counts, value, 1), [{:move_in, {value, original_string}} | events]}
    end
  end

  defp decrement_value(events, value_counts, value, original_string) do
    case Map.fetch!(value_counts, value) do
      1 -> {Map.delete(value_counts, value), [{:move_out, {value, original_string}} | events]}
      count -> {Map.put(value_counts, value, count - 1), events}
    end
  end

  defp add_row_to_tag_indices(tag_indices, key, move_tags) do
    Enum.reduce(move_tags, tag_indices, fn tag, acc when is_binary(tag) ->
      Map.update(acc, tag, MapSet.new([key]), &MapSet.put(&1, key))
    end)
  end

  defp remove_row_from_tag_indices(tag_indices, key, move_tags) do
    Enum.reduce(move_tags, tag_indices, fn tag, acc when is_binary(tag) ->
      case Map.fetch(acc, tag) do
        {:ok, keys} ->
          keys = MapSet.delete(keys, key)

          if MapSet.size(keys) == 0 do
            Map.delete(acc, tag)
          else
            Map.put(acc, tag, keys)
          end

        :error ->
          acc
      end
    end)
  end

  defp pop_keys_from_tag_indices(tag_indices, patterns) do
    Enum.reduce(patterns, {MapSet.new(), tag_indices}, fn %{pos: _pos, value: value},
                                                          {keys, acc} ->
      case Map.pop(acc, value) do
        {nil, acc} -> {keys, acc}
        {tagged_keys, acc} -> {MapSet.union(keys, tagged_keys), acc}
      end
    end)
  end

  defp cancel_matching_move_events(events) do
    ins = events |> Map.get(:move_in, []) |> Enum.sort_by(&elem(&1, 0))
    outs = events |> Map.get(:move_out, []) |> Enum.sort_by(&elem(&1, 0))
    cancel_sorted_pairs(ins, outs, %{move_in: [], move_out: []})
  end

  defp cancel_sorted_pairs([{value, _} | ins], [{value, _} | outs], acc),
    do: cancel_sorted_pairs(ins, outs, acc)

  defp cancel_sorted_pairs([{value1, _} = move_in | ins], [{value2, _} | _] = outs, acc)
       when value1 < value2,
       do: cancel_sorted_pairs(ins, outs, %{acc | move_in: [move_in | acc.move_in]})

  defp cancel_sorted_pairs([{value1, _} | _] = ins, [{value2, _} = move_out | outs], acc)
       when value2 < value1,
       do: cancel_sorted_pairs(ins, outs, %{acc | move_out: [move_out | acc.move_out]})

  defp cancel_sorted_pairs([], [], %{move_in: [], move_out: []}), do: %{}

  defp cancel_sorted_pairs(ins, outs, acc),
    do: %{acc | move_in: ins ++ acc.move_in, move_out: outs ++ acc.move_out}

  defp drop_empty_event_keys(events) do
    Enum.reduce(events, %{}, fn
      {_key, []}, acc -> acc
      {key, value}, acc -> Map.put(acc, key, value)
    end)
  end

  defp fetch_opt!(opts, key) do
    case Map.fetch(opts, key) do
      {:ok, value} -> value
      :error -> raise ArgumentError, "missing required option #{inspect(key)}"
    end
  end
end
