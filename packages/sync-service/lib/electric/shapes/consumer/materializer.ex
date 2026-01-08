defmodule Electric.Shapes.Consumer.Materializer do
  # TODOS:
  # - [x] Keep lockstep with the consumer
  # - [ ] Think about initial materialization needing to finish before we can continue
  # - [ ]
  # - [ ] Use the `get_link_values`

  # NOTES:
  # - Consumer does txn buffering until pg snapshot is known

  # The lifecycle of a materializer is linked to its source consumer. If the consumer
  # goes down for any reason other than a clean supervisor/stack shutdown then we
  # need to invalidate all dependent outer shapes.
  #
  # restart: :temporary because the materalizer crashing brings down dependent shapes
  # and restarting would make no sense.
  use GenServer, restart: :temporary

  alias Electric.Utils
  alias Electric.Replication.Changes
  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.Storage
  alias Electric.Replication.LogOffset
  alias Electric.Replication.Eval
  alias Electric.Shapes.Shape

  import Electric.Replication.LogOffset
  import Electric, only: [is_stack_id: 1, is_shape_handle: 1]
  import Shape, only: :macros

  def name(stack_id, shape_handle) when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def name(%{
        stack_id: stack_id,
        shape_handle: shape_handle
      }) do
    name(stack_id, shape_handle)
  end

  def whereis(%{stack_id: stack_id, shape_handle: shape_handle}),
    do: whereis(stack_id, shape_handle)

  def whereis(stack_id, shape_handle), do: GenServer.whereis(name(stack_id, shape_handle))

  @spec new_changes(map(), list(Changes.change()) | {LogOffset.t(), LogOffset.t()}) :: :ok
  def new_changes(state, changes) do
    GenServer.call(name(state), {:new_changes, changes}, :infinity)
  end

  def wait_until_ready(state) do
    GenServer.call(name(state), :wait_until_ready, :infinity)
  end

  def get_link_values(opts) do
    GenServer.call(name(opts), :get_link_values)
  catch
    :exit, _reason ->
      raise ~s|Materializer for stack "#{opts.stack_id}" and handle "#{opts.shape_handle}" is not available|
  end

  def get_all_as_refs(shape, stack_id) when are_deps_filled(shape) do
    shape.shape_dependencies_handles
    |> Enum.with_index()
    |> Map.new(fn {shape_handle, index} ->
      {["$sublink", Integer.to_string(index)],
       get_link_values(%{
         shape_handle: shape_handle,
         stack_id: stack_id
       })}
    end)
  end

  def subscribe(opts), do: GenServer.call(name(opts), :subscribe)

  def subscribe(stack_id, shape_handle),
    do: subscribe(%{stack_id: stack_id, shape_handle: shape_handle})

  def start_link(opts) do
    GenServer.start_link(__MODULE__, opts, name: name(opts))
  end

  def init(opts) do
    %{stack_id: stack_id, shape_handle: shape_handle} = opts

    Process.set_label({:materializer, shape_handle})
    metadata = [stack_id: stack_id, shape_handle: shape_handle]
    Logger.metadata(metadata)
    Electric.Telemetry.Sentry.set_tags_context(metadata)

    state =
      Map.merge(opts, %{
        index: %{},
        tag_indices: %{},
        # row_tags tracks which tags are associated with each row (key -> MapSet of tags)
        # This is needed for OR-combined subqueries where a row may be in the shape
        # due to multiple different reasons (tags)
        row_tags: %{},
        value_counts: %{},
        offset: LogOffset.before_all(),
        ref: nil,
        subscribers: MapSet.new()
      })

    {:ok, state, {:continue, :start_materializer}}
  end

  def handle_continue(:start_materializer, state) do
    %{stack_id: stack_id, shape_handle: shape_handle} = state

    stack_storage = Storage.for_stack(stack_id)
    shape_storage = Storage.for_shape(shape_handle, stack_storage)

    :started = Consumer.await_snapshot_start(stack_id, shape_handle, :infinity)

    Consumer.subscribe_materializer(stack_id, shape_handle, self())

    Process.monitor(Consumer.whereis(stack_id, shape_handle),
      tag: {:consumer_down, state.shape_handle}
    )

    {:noreply, state, {:continue, {:read_stream, shape_storage}}}
  end

  def handle_continue({:read_stream, storage}, state) do
    {:ok, offset, stream} = get_stream_up_to_date(state.offset, storage)

    {state, _} =
      stream
      |> decode_json_stream()
      |> apply_changes(state)

    {:noreply, %{state | offset: offset}}
  end

  def get_stream_up_to_date(min_offset, storage) do
    case Storage.get_chunk_end_log_offset(min_offset, storage) do
      nil ->
        {:ok, max_offset} = Storage.fetch_latest_offset(storage)

        if is_log_offset_lte(max_offset, min_offset) do
          {:ok, min_offset, []}
        else
          stream = Storage.get_log_stream(min_offset, max_offset, storage)
          {:ok, max_offset, stream}
        end

      max_offset ->
        stream1 = Storage.get_log_stream(min_offset, max_offset, storage)
        {:ok, offset, stream2} = get_stream_up_to_date(max_offset, storage)
        {:ok, offset, Stream.concat(stream1, stream2)}
    end
  end

  def handle_call(:get_link_values, _from, %{value_counts: value_counts} = state) do
    values = MapSet.new(Map.keys(value_counts))

    {:reply, values, state}
  end

  def handle_call(:wait_until_ready, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call({:new_changes, {range_start, range_end}}, _from, state) do
    stack_storage = Storage.for_stack(state.stack_id)
    storage = Storage.for_shape(state.shape_handle, stack_storage)

    Storage.get_log_stream(range_start, range_end, storage)
    |> decode_json_stream()
    |> apply_changes_and_notify(state)
    |> then(fn state -> {:reply, :ok, state} end)
  end

  def handle_call({:new_changes, changes}, _from, state) when is_list(changes) do
    {:reply, :ok, apply_changes_and_notify(changes, state)}
  end

  def handle_call(:subscribe, {pid, _ref} = _from, state) do
    Process.monitor(pid)

    {:reply, :ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
  end

  # if the supervisor is going down then this process will also be taken down
  # but let's state the dependency explictly.
  def handle_info({{:consumer_down, _}, _ref, :process, _pid, :shutdown}, state) do
    {:stop, :shutdown, state}
  end

  def handle_info({{:consumer_down, _}, _ref, :process, _pid, {:shutdown, reason}}, state)
      when reason != :cleanup do
    {:stop, :shutdown, state}
  end

  # notify subscribers of the shape removal if the consumer exit reason is
  # anything other than a clean supervisor shutdown.
  def handle_info({{:consumer_down, _}, _ref, :process, _pid, _reason}, state) do
    for pid <- state.subscribers do
      send(pid, {:materializer_shape_invalidated, state.shape_handle})
    end

    {:stop, :shutdown, state}
  end

  def handle_info({:DOWN, _ref, :process, pid, _reason}, state) do
    {:noreply, %{state | subscribers: MapSet.delete(state.subscribers, pid)}}
  end

  defp decode_json_stream(stream) do
    stream
    |> Stream.map(&Jason.decode!/1)
    |> Enum.filter(fn decoded ->
      Map.has_key?(decoded, "key") || Map.has_key?(decoded["headers"], "event")
    end)
    |> Enum.map(fn
      %{
        "key" => key,
        "value" => value,
        "headers" => %{"operation" => operation} = headers
      } ->
        case operation do
          "insert" ->
            %Changes.NewRecord{key: key, record: value, move_tags: Map.get(headers, "tags", [])}

          "update" ->
            %Changes.UpdatedRecord{
              key: key,
              record: value,
              move_tags: Map.get(headers, "tags", []),
              removed_move_tags: Map.get(headers, "removed_tags", [])
            }

          "delete" ->
            %Changes.DeletedRecord{
              key: key,
              old_record: value,
              move_tags: Map.get(headers, "tags", [])
            }
        end

      %{"headers" => %{"event" => "move-out"} = headers} ->
        patterns =
          Map.get(headers, "patterns", [])
          |> Enum.map(fn %{"pos" => pos, "value" => value} ->
            %{pos: pos, value: value}
          end)

        composite_patterns =
          Map.get(headers, "composite_patterns", [])
          |> Enum.map(fn cp ->
            %{
              sublink_index: cp["sublink_index"],
              values: cp["values"],
              affected_disjuncts: cp["affected_disjuncts"],
              pattern: cp["pattern"]
            }
          end)

        %{headers: %{event: "move-out", patterns: patterns, composite_patterns: composite_patterns}}
    end)
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

  defp apply_changes_and_notify(changes, state) do
    {state, events} = apply_changes(changes, state)

    if events != %{} do
      events =
        events
        |> Map.put_new(:move_in, [])
        |> Map.put_new(:move_out, [])

      for pid <- state.subscribers do
        send(pid, {:materializer_changes, state.shape_handle, events})
      end
    end

    state
  end

  defp apply_changes(changes, state) do
    {{index, tag_indices, row_tags}, {value_counts, events}} =
      Enum.reduce(
        changes,
        {{state.index, state.tag_indices, state.row_tags}, {state.value_counts, []}},
        fn
          %Changes.NewRecord{key: key, record: record, move_tags: move_tags},
          {{index, tag_indices, row_tags}, counts_and_events} ->
            {value, original_string} = cast!(record, state)

            # UPSERT semantics: if key exists, merge tags; otherwise insert new row
            if is_map_key(index, key) do
              # Key exists - merge tags (UPSERT)
              old_value = Map.get(index, key)
              index = Map.put(index, key, value)
              {tag_indices, row_tags} = add_row_to_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags)

              # Update value_counts if value changed
              counts_and_events =
                if old_value != value do
                  counts_and_events
                  |> decrement_value(old_value, value_to_string(old_value, state))
                  |> increment_value(value, original_string)
                else
                  counts_and_events
                end

              {{index, tag_indices, row_tags}, counts_and_events}
            else
              # New key - insert
              index = Map.put(index, key, value)
              {tag_indices, row_tags} = add_row_to_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags)
              {{index, tag_indices, row_tags}, increment_value(counts_and_events, value, original_string)}
            end

          %Changes.UpdatedRecord{
            key: key,
            record: record,
            move_tags: move_tags,
            removed_move_tags: removed_move_tags
          },
          {{index, tag_indices, row_tags}, counts_and_events} ->
            # TODO: this is written as if it supports multiple selected columns, but it doesn't for now
            if Enum.any?(state.columns, &is_map_key(record, &1)) do
              {value, original_string} = cast!(record, state)
              old_value = Map.fetch!(index, key)
              index = Map.put(index, key, value)

              # Remove old tags first, then add new tags
              had_tags_before = Map.has_key?(row_tags, key)
              {tag_indices, row_tags} = remove_row_from_tag_indices_and_row_tags(tag_indices, row_tags, key, removed_move_tags)
              {tag_indices, row_tags} = add_row_to_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags)

              # Only delete row if it previously had tags and now has none.
              # Rows without tags (legacy behavior) should remain.
              key_tags = Map.get(row_tags, key, MapSet.new())
              if had_tags_before and MapSet.size(key_tags) == 0 do
                {_value, index} = Map.pop(index, key)
                row_tags = Map.delete(row_tags, key)
                {{index, tag_indices, row_tags},
                 decrement_value(counts_and_events, old_value, value_to_string(old_value, state))}
              else
                {{index, tag_indices, row_tags},
                 counts_and_events
                 |> decrement_value(old_value, value_to_string(old_value, state))
                 |> increment_value(value, original_string)}
              end
            else
              # Nothing relevant to this materializer has been updated, but still process tags
              had_tags_before = Map.has_key?(row_tags, key)
              {tag_indices, row_tags} = remove_row_from_tag_indices_and_row_tags(tag_indices, row_tags, key, removed_move_tags)
              {tag_indices, row_tags} = add_row_to_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags)

              # Only delete row if it previously had tags and now has none.
              # Rows without tags (legacy behavior) should remain.
              key_tags = Map.get(row_tags, key, MapSet.new())
              if had_tags_before and MapSet.size(key_tags) == 0 and is_map_key(index, key) do
                {value, index} = Map.pop(index, key)
                row_tags = Map.delete(row_tags, key)
                {{index, tag_indices, row_tags},
                 decrement_value(counts_and_events, value, value_to_string(value, state))}
              else
                {{index, tag_indices, row_tags}, counts_and_events}
              end
            end

          %Changes.DeletedRecord{key: key, move_tags: move_tags},
          {{index, tag_indices, row_tags}, counts_and_events} ->
            {value, index} = Map.pop!(index, key)

            {tag_indices, row_tags} = remove_row_from_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags)
            row_tags = Map.delete(row_tags, key)

            {{index, tag_indices, row_tags},
             decrement_value(counts_and_events, value, value_to_string(value, state))}

          %{headers: %{event: "move-out", patterns: patterns} = headers},
          {{index, tag_indices, row_tags}, counts_and_events} ->
            # Move-out must only delete rows when ALL tags are removed

            # Process simple patterns (pre-computed tag hashes)
            {keys_to_maybe_delete, tag_indices, row_tags} = process_move_out_patterns(tag_indices, row_tags, patterns)

            # Process composite patterns (for AND-combined subqueries)
            composite_patterns = Map.get(headers, :composite_patterns, [])
            {composite_keys, tag_indices, row_tags} =
              process_composite_move_out_patterns(index, tag_indices, row_tags, composite_patterns, state)

            keys_to_maybe_delete = MapSet.union(keys_to_maybe_delete, composite_keys)

            # For each key, check if all tags were removed - only then delete the row
            {index, row_tags, counts_and_events} =
              Enum.reduce(keys_to_maybe_delete, {index, row_tags, counts_and_events}, fn key, {index, row_tags, counts_and_events} ->
                key_tags = Map.get(row_tags, key, MapSet.new())
                if MapSet.size(key_tags) == 0 do
                  # All tags removed - delete the row
                  case Map.pop(index, key) do
                    {nil, index} ->
                      {index, row_tags, counts_and_events}

                    {value, index} ->
                      row_tags = Map.delete(row_tags, key)
                      {index, row_tags, decrement_value(counts_and_events, value, value_to_string(value, state))}
                  end
                else
                  # Row still has other tags - keep it
                  {index, row_tags, counts_and_events}
                end
              end)

            {{index, tag_indices, row_tags}, counts_and_events}
        end
      )

    events = Enum.group_by(events, &elem(&1, 0), &elem(&1, 1))

    {%{state | index: index, value_counts: value_counts, tag_indices: tag_indices, row_tags: row_tags}, events}
  end

  defp increment_value({value_counts, events}, value, original_string) do
    case Map.fetch(value_counts, value) do
      {:ok, count} ->
        {Map.put(value_counts, value, count + 1), events}

      :error ->
        {Map.put(value_counts, value, 1), [{:move_in, {value, original_string}} | events]}
    end
  end

  defp decrement_value({value_counts, events}, value, original_string) do
    # If we're decrementing, it must have been added before
    case Map.fetch!(value_counts, value) do
      1 ->
        {Map.delete(value_counts, value), [{:move_out, {value, original_string}} | events]}

      count ->
        {Map.put(value_counts, value, count - 1), events}
    end
  end

  # Add tags to both tag_indices and row_tags for a given key
  # Now supports multiple tags per row for OR-combined subqueries
  defp add_row_to_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags) do
    Enum.reduce(move_tags, {tag_indices, row_tags}, fn tag, {tag_indices, row_tags} when is_binary(tag) ->
      tag_indices = Map.update(tag_indices, tag, MapSet.new([key]), &MapSet.put(&1, key))
      row_tags = Map.update(row_tags, key, MapSet.new([tag]), &MapSet.put(&1, tag))
      {tag_indices, row_tags}
    end)
  end

  # Remove tags from both tag_indices and row_tags for a given key
  defp remove_row_from_tag_indices_and_row_tags(tag_indices, row_tags, key, move_tags) do
    Enum.reduce(move_tags, {tag_indices, row_tags}, fn tag, {tag_indices, row_tags} when is_binary(tag) ->
      # Update tag_indices
      tag_indices =
        case Map.fetch(tag_indices, tag) do
          {:ok, v} ->
            new_mapset = MapSet.delete(v, key)
            if MapSet.size(new_mapset) == 0 do
              Map.delete(tag_indices, tag)
            else
              Map.put(tag_indices, tag, new_mapset)
            end

          :error ->
            tag_indices
        end

      # Update row_tags
      row_tags =
        case Map.fetch(row_tags, key) do
          {:ok, tags} ->
            new_tags = MapSet.delete(tags, tag)
            if MapSet.size(new_tags) == 0 do
              Map.delete(row_tags, key)
            else
              Map.put(row_tags, key, new_tags)
            end

          :error ->
            row_tags
        end

      {tag_indices, row_tags}
    end)
  end

  # Process composite move-out patterns for AND-combined subqueries.
  # These patterns contain sublink info and values rather than pre-computed tag hashes.
  #
  # Tag format: "d{disjunct_index}:{value_parts_base64}:{hash}"
  # Where value_parts is like: "0:42/1:abc" (sublink_index:value pairs joined by /)
  #
  # For value-aware removal, we:
  # 1. Find tags for affected disjuncts
  # 2. Parse the tag to decode value_parts
  # 3. Check if the moved-out sublink's value matches
  # 4. Only remove tags that actually match
  defp process_composite_move_out_patterns(_index, tag_indices, row_tags, [], _state) do
    {MapSet.new(), tag_indices, row_tags}
  end

  defp process_composite_move_out_patterns(_index, tag_indices, row_tags, composite_patterns, _state) do
    Enum.reduce(composite_patterns, {MapSet.new(), tag_indices, row_tags}, fn
      %{sublink_index: sublink_index, values: gone_values, affected_disjuncts: disjunct_indices},
      {keys_to_check, tag_indices, row_tags} ->
        # Build prefixes for affected disjuncts
        affected_prefixes =
          MapSet.new(disjunct_indices, fn idx -> "d#{idx}:" end)

        # Normalize gone_values to a set of string patterns we're looking for
        # For simple values: "sublink_index:value"
        # For composite values: "sublink_index:val1:val2:..."
        gone_value_patterns =
          MapSet.new(gone_values, fn value ->
            case value do
              v when is_binary(v) -> "#{sublink_index}:#{v}"
              v when is_list(v) -> "#{sublink_index}:#{Enum.join(v, ":")}"
            end
          end)

        # Find tags that belong to affected disjuncts AND match the moved-out values
        tags_to_remove =
          tag_indices
          |> Map.keys()
          |> Enum.filter(fn tag ->
            # Check if tag is for an affected disjunct
            tag_matches_disjunct = Enum.any?(affected_prefixes, &String.starts_with?(tag, &1))

            if tag_matches_disjunct do
              # Parse the tag to check if the moved-out value matches
              tag_contains_moved_out_value?(tag, gone_value_patterns)
            else
              false
            end
          end)

        # Remove matching tags and collect affected keys
        {tag_indices, row_tags, affected_keys} =
          Enum.reduce(tags_to_remove, {tag_indices, row_tags, MapSet.new()}, fn tag, {ti, rt, ak} ->
            case Map.pop(ti, tag) do
              {nil, ti} ->
                {ti, rt, ak}

              {keys, ti} ->
                # Remove this tag from all affected keys' row_tags
                rt =
                  Enum.reduce(keys, rt, fn key, rt ->
                    case Map.fetch(rt, key) do
                      {:ok, tags} ->
                        new_tags = MapSet.delete(tags, tag)
                        if MapSet.size(new_tags) == 0 do
                          Map.delete(rt, key)
                        else
                          Map.put(rt, key, new_tags)
                        end

                      :error ->
                        rt
                    end
                  end)

                {ti, rt, MapSet.union(ak, keys)}
            end
          end)

        {MapSet.union(keys_to_check, affected_keys), tag_indices, row_tags}
    end)
  end

  # Check if a tag contains the moved-out value for the specified sublink.
  # Tag format: "d{index}:{value_parts_base64}:{hash}"
  # value_parts format: "0:42/1:abc" (sublink_index:value pairs joined by /)
  defp tag_contains_moved_out_value?(tag, gone_value_patterns) do
    case String.split(tag, ":", parts: 3) do
      [_disjunct_prefix, value_parts_encoded, _hash] ->
        case Base.url_decode64(value_parts_encoded, padding: false) do
          {:ok, value_parts} ->
            # value_parts is like "0:42" or "0:42/1:abc"
            # Split by "/" to get individual sublink:value pairs
            sublink_values = String.split(value_parts, "/")

            # Check if any of the moved-out patterns match
            Enum.any?(sublink_values, fn sublink_value ->
              MapSet.member?(gone_value_patterns, sublink_value)
            end)

          :error ->
            # If decoding fails, fall back to removing (conservative)
            true
        end

      _ ->
        # Old format tag without encoded values, fall back to removing
        true
    end
  end

  # Process move-out patterns: remove tags from tag_indices and row_tags
  # Returns {keys_to_check, updated_tag_indices, updated_row_tags}
  # Keys should be checked afterwards to see if they should be deleted (when all tags are removed)
  defp process_move_out_patterns(tag_indices, row_tags, patterns) do
    Enum.reduce(patterns, {MapSet.new(), tag_indices, row_tags}, fn %{pos: _pos, value: tag},
                                                                    {keys_to_check, tag_indices, row_tags} ->
      case Map.pop(tag_indices, tag) do
        {nil, tag_indices} ->
          {keys_to_check, tag_indices, row_tags}

        {affected_keys, tag_indices} ->
          # For each affected key, remove this tag from row_tags
          row_tags =
            Enum.reduce(affected_keys, row_tags, fn key, row_tags ->
              case Map.fetch(row_tags, key) do
                {:ok, tags} ->
                  new_tags = MapSet.delete(tags, tag)
                  if MapSet.size(new_tags) == 0 do
                    Map.delete(row_tags, key)
                  else
                    Map.put(row_tags, key, new_tags)
                  end

                :error ->
                  row_tags
              end
            end)

          {MapSet.union(keys_to_check, affected_keys), tag_indices, row_tags}
      end
    end)
  end

end
