defmodule Electric.Shapes.Consumer.Materializer do
  use GenServer, restart: :temporary

  require Logger

  alias Electric.Replication.Changes
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer
  alias Electric.Shapes.Consumer.Subqueries.MaterializedView
  alias Electric.Shapes.Shape

  import Electric.Replication.LogOffset
  import Electric, only: [is_shape_handle: 1, is_stack_id: 1]
  import Shape, only: :macros

  def name(stack_id, shape_handle) when is_stack_id(stack_id) and is_shape_handle(shape_handle) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__, shape_handle)
  end

  def name(%{stack_id: stack_id, shape_handle: shape_handle}) do
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
      {[
         "$sublink",
         Integer.to_string(index)
       ], get_link_values(%{shape_handle: shape_handle, stack_id: stack_id})}
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
        view:
          MaterializedView.new(
            dependency_handle: shape_handle,
            columns: opts[:columns],
            materialized_type: opts[:materialized_type]
          ),
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
      :exit, reason ->
        Logger.warning("Materializer startup failed with exit reason: #{inspect(reason)}")
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

    {:noreply, %{state | offset: offset}}
  end

  @doc """
  Get a stream of log entries from storage, bounded by the subscribed offset.

  The subscribed_offset is the Consumer's latest_offset at the time of subscription.
  We only read up to this offset to avoid duplicates - any changes after this offset
  will be delivered via new_changes messages from the Consumer.
  """
  def get_stream_up_to_offset(min_offset, subscribed_offset, storage) do
    if is_nil(subscribed_offset) or is_log_offset_lte(subscribed_offset, min_offset) do
      {:ok, min_offset, []}
    else
      stream = Storage.get_log_stream(min_offset, subscribed_offset, storage)
      {:ok, subscribed_offset, stream}
    end
  end

  def handle_call(:get_link_values, _from, %{view: view} = state) do
    {:reply, MaterializedView.values(view), state}
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

  def handle_call(:subscribe, {pid, _ref}, state) do
    Process.monitor(pid)
    {:reply, :ok, %{state | subscribers: MapSet.put(state.subscribers, pid)}}
  end

  def handle_info({{:consumer_down, _}, _ref, :process, _pid, :shutdown}, state) do
    {:stop, :shutdown, state}
  end

  def handle_info({{:consumer_down, _}, _ref, :process, _pid, {:shutdown, reason}}, state)
      when reason != :cleanup do
    {:stop, :shutdown, state}
  end

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

  defp apply_and_accumulate_events(changes, state) do
    {state, events} = apply_changes(changes, state)
    %{state | pending_events: merge_events(state.pending_events, events)}
  end

  defp maybe_flush_pending_events(state, true) do
    events = cancel_matching_move_events(state.pending_events)

    if events != %{} do
      for pid <- state.subscribers do
        send(pid, {:materializer_changes, state.shape_handle, events})
      end
    end

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
    case MaterializedView.handle_changes(state.view, changes) do
      {nil, view} ->
        {%{state | view: view}, %{}}

      {{:materializer_changes, _dep_handle, payload}, view} ->
        {%{state | view: view}, payload}
    end
  end
end
