defmodule Electric.Shapes.Consumer.Materializer do
  # The lifecycle of a materializer is linked to its source consumer. If the consumer
  # goes down for any reason other than a clean supervisor/stack shutdown then we
  # need to invalidate all dependent outer shapes.
  #
  # restart: :temporary because the materalizer crashing brings down dependent shapes
  # and restarting would make no sense.
  use GenServer, restart: :temporary

  require Logger

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

  @spec new_changes(map(), list(Changes.change()) | {LogOffset.t(), LogOffset.t()}, keyword()) ::
          :ok
  def new_changes(state, changes, opts \\ []) do
    commit? = Keyword.get(opts, :commit, true)
    GenServer.call(name(state), {:new_changes, changes, commit?}, :infinity)
  end

  def wait_until_ready(state) do
    GenServer.call(name(state), :wait_until_ready, :infinity)
  end

  @doc """
  Creates the per-stack ETS table that caches link values for all materializers
  in a stack. Called by `ConsumerRegistry` during stack initialization. Idempotent —
  safe to call when the table already exists.
  """
  @spec init_link_values_table(stack_id :: term()) :: :ets.table() | :undefined
  def init_link_values_table(stack_id) do
    :ets.new(link_values_table_name(stack_id), [
      :named_table,
      :public,
      :set,
      read_concurrency: true,
      write_concurrency: true
    ])
  rescue
    ArgumentError -> :ets.whereis(link_values_table_name(stack_id))
  end

  @doc """
  Returns the current set of materialized link values for a shape.
  Checks the shared ETS cache first (written after each committed transaction);
  falls back to a synchronous GenServer call if the cache has no entry yet.
  """
  def get_link_values(%{stack_id: stack_id, shape_handle: shape_handle} = opts) do
    table = link_values_table_name(stack_id)

    case :ets.lookup(table, shape_handle) do
      [{^shape_handle, values}] -> values
      _ -> genserver_get_link_values(opts)
    end
  rescue
    ArgumentError -> genserver_get_link_values(opts)
  end

  defp genserver_get_link_values(opts) do
    GenServer.call(name(opts), :get_link_values)
  catch
    :exit, reason ->
      raise "Materializer for stack #{inspect(opts.stack_id)} and handle " <>
              "#{inspect(opts.shape_handle)} is not available: #{inspect(reason)}"
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

  def subscribe(pid) when is_pid(pid), do: GenServer.call(pid, :subscribe)

  def subscribe(opts) when is_map(opts), do: GenServer.call(name(opts), :subscribe)

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
        value_counts: %{},
        pending_events: %{},
        offset: LogOffset.before_all(),
        subscribed_offset: nil,
        ref: nil,
        subscribers: MapSet.new()
      })

    {:ok, state, {:continue, :start_materializer}}
  end

  def handle_continue(:start_materializer, state) do
    %{stack_id: stack_id, shape_handle: shape_handle} = state

    stack_storage = Storage.for_stack(stack_id)
    shape_storage = Storage.for_shape(shape_handle, stack_storage)

    try do
      case Consumer.await_snapshot_start(stack_id, shape_handle, :infinity) do
        :started ->
          {:ok, subscribed_offset} =
            Consumer.subscribe_materializer(stack_id, shape_handle, self())

          Process.monitor(Consumer.whereis(stack_id, shape_handle),
            tag: {:consumer_down, state.shape_handle}
          )

          {:noreply, %{state | subscribed_offset: subscribed_offset},
           {:continue, {:read_stream, shape_storage}}}

        {:error, _reason} ->
          {:stop, :shutdown, state}
      end
    catch
      # GenServer.call fails with :exit when Consumer is dead or dies mid-call
      :exit, reason ->
        Logger.warning("Materializer startup failed with exit reason", reason: reason)
        {:stop, :shutdown, state}
    end
  end

  def handle_continue({:read_stream, storage}, state) do
    {:ok, offset, stream} =
      get_stream_up_to_offset(state.offset, state.subscribed_offset, storage)

    {state, _} =
      stream
      |> decode_json_stream()
      |> apply_changes(state)

    write_link_values(state)

    {:noreply, %{state | offset: offset}}
  end

  @doc """
  Get a stream of log entries from storage, bounded by the subscribed offset.

  The subscribed_offset is the Consumer's latest_offset at the time of subscription.
  We only read up to this offset to avoid duplicates - any changes after this offset
  will be delivered via new_changes messages from the Consumer.
  """
  def get_stream_up_to_offset(min_offset, subscribed_offset, storage) do
    # If subscribed_offset is nil or at/before min_offset, nothing to read
    if is_nil(subscribed_offset) or is_log_offset_lte(subscribed_offset, min_offset) do
      {:ok, min_offset, []}
    else
      stream = Storage.get_log_stream(min_offset, subscribed_offset, storage)
      {:ok, subscribed_offset, stream}
    end
  end

  def handle_call(:get_link_values, _from, %{value_counts: value_counts} = state) do
    {:reply, link_values_from_counts(value_counts), state}
  end

  def handle_call(:wait_until_ready, _from, state) do
    {:reply, :ok, state}
  end

  def handle_call({:new_changes, {range_start, range_end}, commit?}, _from, state) do
    stack_storage = Storage.for_stack(state.stack_id)
    storage = Storage.for_shape(state.shape_handle, stack_storage)

    state =
      Storage.get_log_stream(range_start, range_end, storage)
      |> decode_json_stream()
      |> apply_and_accumulate_events(state)
      |> maybe_flush_pending_events(commit?)

    {:reply, :ok, state}
  end

  def handle_call({:new_changes, changes, commit?}, _from, state) when is_list(changes) do
    state =
      changes
      |> apply_and_accumulate_events(state)
      |> maybe_flush_pending_events(commit?)

    {:reply, :ok, state}
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

  @spec link_values_table_name(Electric.stack_id()) :: atom()
  def link_values_table_name(stack_id) do
    :"Electric.Materializer.LinkValues:#{stack_id}"
  end

  @doc """
  Removes the cached link values for `shape_handle` from the shared ETS table.
  Safe to call even if the table does not exist (e.g. after a stack shutdown).
  """
  @spec delete_link_values(Electric.stack_id(), Electric.shape_handle()) :: :ok
  def delete_link_values(stack_id, shape_handle) do
    :ets.delete(link_values_table_name(stack_id), shape_handle)
    :ok
  rescue
    ArgumentError ->
      Logger.debug(fn ->
        "delete_link_values: link-values table for stack #{inspect(stack_id)} " <>
          "not found when deleting handle #{inspect(shape_handle)}"
      end)

      :ok
  end

  defp link_values_from_counts(value_counts) do
    MapSet.new(Map.keys(value_counts))
  end

  defp write_link_values(%{
         stack_id: stack_id,
         shape_handle: shape_handle,
         value_counts: value_counts
       }) do
    :ets.insert(
      link_values_table_name(stack_id),
      {shape_handle, link_values_from_counts(value_counts)}
    )
  rescue
    ArgumentError ->
      Logger.warning(
        "write_link_values: link-values ETS table missing for stack #{inspect(stack_id)} " <>
          "— cache will fall back to GenServer calls for handle #{inspect(shape_handle)}"
      )

      :ok
  end

  defp decode_json_stream(stream) do
    stream
    |> Stream.map(&Jason.decode!/1)
    |> Stream.filter(fn decoded ->
      Map.has_key?(decoded, "key") || Map.has_key?(decoded["headers"], "event")
    end)
    |> Stream.map(fn
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

      %{"headers" => %{"event" => "move-out", "patterns" => patterns}} ->
        patterns =
          Enum.map(patterns, fn %{"pos" => pos, "value" => value} ->
            %{pos: pos, value: value}
          end)

        %{headers: %{event: "move-out", patterns: patterns}}
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

  defp apply_and_accumulate_events(changes, state) do
    {state, events} = apply_changes(changes, state)
    %{state | pending_events: merge_events(state.pending_events, events)}
  end

  defp maybe_flush_pending_events(state, true) do
    events =
      cancel_matching_move_events(state.pending_events)

    if events != %{} do
      for pid <- state.subscribers do
        send(pid, {:materializer_changes, state.shape_handle, events})
      end
    end

    write_link_values(state)

    %{state | pending_events: %{}}
  end

  defp maybe_flush_pending_events(state, _commit?), do: state

  defp merge_events(pending, new) when pending == %{}, do: new
  defp merge_events(pending, new) when new == %{}, do: pending

  defp merge_events(pending, new) do
    %{
      move_in: Map.get(new, :move_in, []) ++ Map.get(pending, :move_in, []),
      move_out: Map.get(new, :move_out, []) ++ Map.get(pending, :move_out, [])
    }
  end

  # A value's count can cross the 0↔1 boundary multiple times in a single batch
  # (e.g., toggled twice in one transaction: 0→1 move_in, 1→0 move_out, 0→1 move_in).
  # Emitting both move_in and move_out for the same value causes the consumer to
  # fire a move-in query while simultaneously marking the value's tag as moved-out,
  # which filters out the query results - losing the data entirely.
  #
  # We resolve this by sorting events by value, then walking through the list
  # cancelling adjacent move_in/move_out pairs for the same value.
  defp cancel_matching_move_events(events) do
    ins = events |> Map.get(:move_in, []) |> Enum.sort_by(fn {v, _} -> v end)
    outs = events |> Map.get(:move_out, []) |> Enum.sort_by(fn {v, _} -> v end)
    cancel_sorted_pairs(ins, outs, %{move_in: [], move_out: []})
  end

  defp cancel_sorted_pairs([{v, _} | ins], [{v, _} | outs], acc),
    do: cancel_sorted_pairs(ins, outs, acc)

  defp cancel_sorted_pairs([{v1, _} = i | ins], [{v2, _} | _] = outs, acc) when v1 < v2,
    do: cancel_sorted_pairs(ins, outs, %{acc | move_in: [i | acc.move_in]})

  defp cancel_sorted_pairs([{v1, _} | _] = ins, [{v2, _} = o | outs], acc) when v2 < v1,
    do: cancel_sorted_pairs(ins, outs, %{acc | move_out: [o | acc.move_out]})

  defp cancel_sorted_pairs([], [], %{move_in: [], move_out: []}), do: %{}

  defp cancel_sorted_pairs(ins, outs, acc),
    do: %{acc | move_in: ins ++ acc.move_in, move_out: outs ++ acc.move_out}

  defp apply_changes(changes, state) do
    {{index, tag_indices}, {value_counts, events}} =
      Enum.reduce(
        changes,
        {{state.index, state.tag_indices}, {state.value_counts, []}},
        fn
          %Changes.NewRecord{key: key, record: record, move_tags: move_tags},
          {{index, tag_indices}, counts_and_events} ->
            {value, original_string} = cast!(record, state)
            if is_map_key(index, key), do: raise("Key #{key} already exists")
            index = Map.put(index, key, value)
            tag_indices = add_row_to_tag_indices(tag_indices, key, move_tags)
            {{index, tag_indices}, increment_value(counts_and_events, value, original_string)}

          %Changes.UpdatedRecord{
            key: key,
            old_key: old_key,
            record: record,
            move_tags: move_tags,
            removed_move_tags: removed_move_tags
          },
          {{index, tag_indices}, counts_and_events} ->
            # When the primary key doesn't change, old_key may be nil; default to key
            old_key = old_key || key

            # TODO: this is written as if it supports multiple selected columns, but it doesn't for now
            columns_present = Enum.any?(state.columns, &is_map_key(record, &1))
            has_tag_updates = removed_move_tags != []
            pk_changed = old_key != key

            if columns_present or has_tag_updates or pk_changed do
              # When PK changes, old_key must be removed from all tag indices it
              # belongs to (both removed and retained tags), not just removed_move_tags
              tags_to_remove =
                if pk_changed,
                  do: removed_move_tags ++ move_tags,
                  else: removed_move_tags

              tag_indices =
                tag_indices
                |> remove_row_from_tag_indices(old_key, tags_to_remove)
                |> add_row_to_tag_indices(key, move_tags)

              if columns_present do
                {value, original_string} = cast!(record, state)
                {old_value, index} = Map.pop!(index, old_key)
                index = Map.put(index, key, value)

                # Skip decrement/increment dance if value hasn't changed to avoid
                # spurious move_out/move_in events when only the tag changed
                if old_value == value do
                  {{index, tag_indices}, counts_and_events}
                else
                  {{index, tag_indices},
                   counts_and_events
                   |> decrement_value(old_value, value_to_string(old_value, state))
                   |> increment_value(value, original_string)}
                end
              else
                # PK changed but tracked column not in record — re-key the index entry
                index =
                  if pk_changed do
                    {value, index} = Map.pop!(index, old_key)
                    Map.put(index, key, value)
                  else
                    index
                  end

                {{index, tag_indices}, counts_and_events}
              end
            else
              # Nothing relevant to this materializer has been updated
              {{index, tag_indices}, counts_and_events}
            end

          %Changes.DeletedRecord{key: key, move_tags: move_tags},
          {{index, tag_indices}, counts_and_events} ->
            {value, index} = Map.pop!(index, key)

            tag_indices = remove_row_from_tag_indices(tag_indices, key, move_tags)

            {{index, tag_indices},
             decrement_value(counts_and_events, value, value_to_string(value, state))}

          %{headers: %{event: "move-out", patterns: patterns}},
          {{index, tag_indices}, counts_and_events} ->
            {keys, tag_indices} = pop_keys_from_tag_indices(tag_indices, patterns)

            {index, counts_and_events} =
              Enum.reduce(keys, {index, counts_and_events}, fn key, {index, counts_and_events} ->
                {value, index} = Map.pop!(index, key)
                {index, decrement_value(counts_and_events, value, value_to_string(value, state))}
              end)

            {{index, tag_indices}, counts_and_events}
        end
      )

    events = Enum.group_by(events, &elem(&1, 0), &elem(&1, 1))

    {%{state | index: index, value_counts: value_counts, tag_indices: tag_indices}, events}
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

  defp add_row_to_tag_indices(tag_indices, key, move_tags) do
    # For now we only support one move tag per row (i.e. no `OR`s in the where clause if there's a subquery)
    Enum.reduce(move_tags, tag_indices, fn tag, acc when is_binary(tag) ->
      Map.update(acc, tag, MapSet.new([key]), &MapSet.put(&1, key))
    end)
  end

  defp remove_row_from_tag_indices(tag_indices, key, move_tags) do
    Enum.reduce(move_tags, tag_indices, fn tag, acc when is_binary(tag) ->
      case Map.fetch(acc, tag) do
        {:ok, v} ->
          new_mapset = MapSet.delete(v, key)

          if MapSet.size(new_mapset) == 0 do
            Map.delete(acc, tag)
          else
            Map.put(acc, tag, new_mapset)
          end

        :error ->
          acc
      end
    end)
  end

  defp pop_keys_from_tag_indices(tag_indices, patterns) do
    # This implementation is naive while we support only one tag per row and no composite tags.
    Enum.reduce(patterns, {MapSet.new(), tag_indices}, fn %{pos: _pos, value: value},
                                                          {keys, acc} ->
      case Map.pop(acc, value) do
        {nil, acc} -> {keys, acc}
        {v, acc} -> {MapSet.union(keys, v), acc}
      end
    end)
  end
end
