defmodule Electric.Shapes.Api.Multiplex.WebSocket do
  @moduledoc false

  @behaviour WebSock

  alias Electric.Replication.LogOffset
  alias Electric.Shapes.Api.Multiplex
  alias Electric.Shapes.Api.Multiplex.Source

  @status_check_interval 5_000
  @max_identifier_bytes 512
  @max_cursor_bytes 128

  defmodule State do
    @moduledoc false

    defstruct [
      :api,
      :availability_guard,
      :deadline_timer_at,
      :deadline_timer_ref,
      :deadline_timer_token,
      :source_opts,
      :status_timer_ref,
      deadlines: :gb_trees.empty(),
      handles: %{},
      refs: %{},
      source: Source,
      status_check_interval: 5_000,
      watches: %{}
    ]
  end

  @impl WebSock
  def init(opts) do
    state = %State{
      api: fetch_opt!(opts, :api),
      availability_guard: Access.get(opts, :availability_guard),
      source: Access.get(opts, :multiplex_source, Source),
      source_opts: Access.get(opts, :multiplex_source_opts),
      status_check_interval:
        Access.get(opts, :multiplex_status_check_interval, @status_check_interval)
    }

    if available?(state) do
      {:ok, schedule_status_check(state)}
    else
      unavailable(state)
    end
  end

  @impl WebSock
  def handle_in({payload, opcode: :text}, %State{} = state) do
    if available?(state) do
      case Jason.decode(payload) do
        {:ok, %{"type" => "watch"} = frame} -> add_watch(frame, state)
        {:ok, %{"type" => "unwatch"} = frame} -> unwatch(frame, state)
        {:ok, _} -> push_error(state, nil, "invalid_frame", "Unknown frame type", false)
        {:error, _} -> push_error(state, nil, "invalid_json", "Frame must be valid JSON", false)
      end
    else
      unavailable(state)
    end
  end

  def handle_in({_payload, opcode: :binary}, %State{} = state) do
    push_error(state, nil, "invalid_frame", "Only JSON text frames are supported", false)
  end

  @impl WebSock
  def handle_info(
        {:multiplex_deadline, token},
        %State{deadline_timer_token: token} = state
      ) do
    state = %{
      state
      | deadline_timer_at: nil,
        deadline_timer_ref: nil,
        deadline_timer_token: nil
    }

    if available?(state) do
      {expired, state} = pop_expired(state, monotonic_ms(), [])

      frames =
        Enum.map(expired, fn watch ->
          Multiplex.no_change_frame(
            watch.id,
            state.api,
            watch.handle,
            watch.offset,
            watch.cursor
          )
        end)

      state = sync_deadline_timer(state)
      push_frames(frames, state)
    else
      unavailable(state)
    end
  end

  def handle_info({:multiplex_deadline, _stale_token}, %State{} = state), do: {:ok, state}

  def handle_info(:multiplex_check_availability, %State{} = state) do
    state = %{state | status_timer_ref: nil}

    if available?(state) do
      {:ok, schedule_status_check(state)}
    else
      unavailable(state)
    end
  end

  def handle_info({ref, :new_changes, %LogOffset{} = latest_offset}, %State{} = state) do
    case Map.fetch(state.refs, ref) do
      {:ok, handle} -> wake_changed_watches(state, handle, latest_offset)
      :error -> {:ok, state}
    end
  end

  def handle_info({ref, :shape_rotation, _new_handle}, %State{} = state) do
    wake_rotated_watches(state, ref)
  end

  def handle_info({ref, :shape_rotation}, %State{} = state) do
    wake_rotated_watches(state, ref)
  end

  def handle_info(_message, %State{} = state), do: {:ok, state}

  @impl WebSock
  def terminate(_reason, %State{} = state) do
    cancel_timer(state.deadline_timer_ref)
    cancel_timer(state.status_timer_ref)

    Enum.each(Map.keys(state.handles), fn handle ->
      safe_unsubscribe(state, handle)
    end)

    :ok
  end

  defp add_watch(frame, state) do
    already_subscribed? =
      is_binary(frame["handle"]) and Map.has_key?(state.handles, frame["handle"])

    with {:ok, watch} <- validate_watch(frame, state),
         {:ok, latest_offset} <- lookup(state, watch.handle) do
      case LogOffset.compare(watch.offset, latest_offset) do
        :lt ->
          push_frame(Multiplex.wake_frame(watch.id, :changes), state)

        :eq ->
          arm_watch(watch, latest_offset, not already_subscribed?, state)

        :gt ->
          push_frame(Multiplex.wake_frame(watch.id, :rotation), state)
      end
    else
      {:error, id, code, message, retryable} ->
        push_error(state, id, code, message, retryable)

      :not_found ->
        id = valid_id_or_nil(frame["id"])
        push_error(state, id, "shape_not_found", "Shape handle does not exist", true)
    end
  end

  defp arm_watch(watch, initial_offset, recheck?, state) do
    with {:ok, state} <- ensure_subscribed(state, watch.handle) do
      watch = %{watch | deadline: monotonic_ms() + state.api.long_poll_timeout}
      state = put_watch(state, watch)

      if recheck? do
        recheck_armed_watch(watch, initial_offset, state)
      else
        state = sync_deadline_timer(state)
        push_frame(Multiplex.ready_frame(watch.id), state)
      end
    else
      {:error, _reason} ->
        push_error(
          state,
          watch.id,
          "subscription_failed",
          "Unable to subscribe to shape changes",
          true
        )
    end
  end

  # Subscribe before re-reading the head. Any change in the gap is now either
  # visible here or queued as a registry event for this process.
  defp recheck_armed_watch(watch, initial_offset, state) do
    case lookup(state, watch.handle) do
      {:ok, latest_offset} ->
        cond do
          LogOffset.compare(latest_offset, initial_offset) == :lt ->
            state = state |> remove_watch(watch.id) |> sync_deadline_timer()
            push_frame(Multiplex.wake_frame(watch.id, :rotation), state)

          LogOffset.compare(watch.offset, latest_offset) == :lt ->
            state = state |> remove_watch(watch.id) |> sync_deadline_timer()
            push_frame(Multiplex.wake_frame(watch.id, :changes), state)

          LogOffset.compare(watch.offset, latest_offset) == :eq ->
            state = sync_deadline_timer(state)
            push_frame(Multiplex.ready_frame(watch.id), state)

          true ->
            state = state |> remove_watch(watch.id) |> sync_deadline_timer()
            push_frame(Multiplex.wake_frame(watch.id, :rotation), state)
        end

      :not_found ->
        state = state |> remove_watch(watch.id) |> sync_deadline_timer()
        push_frame(Multiplex.wake_frame(watch.id, :rotation), state)
    end
  end

  defp unwatch(%{"id" => id}, state) when is_binary(id) do
    state = state |> remove_watch(id) |> sync_deadline_timer()
    {:ok, state}
  end

  defp unwatch(frame, state) do
    push_error(
      state,
      valid_id_or_nil(frame["id"]),
      "invalid_frame",
      "Unwatch id must be a string",
      false
    )
  end

  defp validate_watch(frame, state) do
    id = frame["id"]
    handle = frame["handle"]
    offset = frame["offset"]

    cond do
      not valid_identifier?(id) ->
        {:error, nil, "invalid_frame", "Watch id must be a non-empty string", false}

      Map.has_key?(state.watches, id) ->
        {:error, id, "duplicate_id", "Watch id is already active", false}

      not valid_identifier?(handle) ->
        {:error, id, "invalid_frame", "Shape handle must be a non-empty string", false}

      not Map.has_key?(frame, "cursor") ->
        {:error, id, "invalid_frame", "Watch cursor is required", false}

      not valid_cursor?(frame["cursor"]) ->
        {:error, id, "invalid_frame", "Watch cursor must be a string or null", false}

      not is_binary(offset) ->
        {:error, id, "invalid_offset", "Watch offset must be a string", false}

      true ->
        case LogOffset.from_string(offset) do
          {:ok, %LogOffset{tx_offset: tx_offset, op_offset: op_offset} = parsed_offset}
          when tx_offset >= 0 and
                 ((is_integer(op_offset) and op_offset >= 0) or
                    (tx_offset == 0 and op_offset == :infinity)) ->
            {:ok,
             %{
               id: id,
               handle: handle,
               offset: parsed_offset,
               cursor: frame["cursor"],
               deadline: nil
             }}

          _ ->
            {:error, id, "invalid_offset", "Watch offset is not a live shape offset", false}
        end
    end
  end

  defp ensure_subscribed(%State{handles: handles} = state, handle)
       when is_map_key(handles, handle) do
    {:ok, state}
  end

  defp ensure_subscribed(state, handle) do
    ref = make_ref()

    case safe_subscribe(state, handle, ref) do
      :ok ->
        {:ok,
         %{
           state
           | handles: Map.put(state.handles, handle, %{ids: MapSet.new(), ref: ref}),
             refs: Map.put(state.refs, ref, handle)
         }}

      {:error, _reason} = error ->
        error
    end
  end

  defp put_watch(state, watch) do
    handles =
      Map.update!(state.handles, watch.handle, fn subscription ->
        %{subscription | ids: MapSet.put(subscription.ids, watch.id)}
      end)

    %{
      state
      | watches: Map.put(state.watches, watch.id, watch),
        handles: handles,
        deadlines: :gb_trees.insert({watch.deadline, watch.id}, true, state.deadlines)
    }
  end

  defp remove_watch(state, id) do
    case Map.pop(state.watches, id) do
      {nil, _watches} ->
        state

      {watch, watches} ->
        deadlines = :gb_trees.delete_any({watch.deadline, watch.id}, state.deadlines)
        subscription = Map.fetch!(state.handles, watch.handle)
        remaining_ids = MapSet.delete(subscription.ids, watch.id)

        if MapSet.size(remaining_ids) == 0 do
          safe_unsubscribe(state, watch.handle)

          %{
            state
            | watches: watches,
              deadlines: deadlines,
              handles: Map.delete(state.handles, watch.handle),
              refs: Map.delete(state.refs, subscription.ref)
          }
        else
          %{
            state
            | watches: watches,
              deadlines: deadlines,
              handles: Map.put(state.handles, watch.handle, %{subscription | ids: remaining_ids})
          }
        end
    end
  end

  defp wake_changed_watches(state, handle, latest_offset) do
    ids = state.handles |> Map.fetch!(handle) |> Map.fetch!(:ids)

    ids_to_wake =
      Enum.filter(ids, fn id ->
        watch = Map.fetch!(state.watches, id)
        LogOffset.compare(watch.offset, latest_offset) == :lt
      end)

    state =
      ids_to_wake
      |> Enum.reduce(state, fn id, state -> remove_watch(state, id) end)
      |> sync_deadline_timer()

    frames = Enum.map(ids_to_wake, &Multiplex.wake_frame(&1, :changes))
    push_frames(frames, state)
  end

  defp wake_rotated_watches(state, ref) do
    case Map.fetch(state.refs, ref) do
      {:ok, handle} ->
        ids = state.handles |> Map.fetch!(handle) |> Map.fetch!(:ids) |> Enum.to_list()

        state =
          ids
          |> Enum.reduce(state, fn id, state -> remove_watch(state, id) end)
          |> sync_deadline_timer()

        frames = Enum.map(ids, &Multiplex.wake_frame(&1, :rotation))
        push_frames(frames, state)

      :error ->
        {:ok, state}
    end
  end

  defp pop_expired(state, now, acc) do
    if :gb_trees.is_empty(state.deadlines) do
      {Enum.reverse(acc), state}
    else
      {{deadline, id}, _value} = :gb_trees.smallest(state.deadlines)

      if deadline <= now do
        watch = Map.fetch!(state.watches, id)
        state = remove_watch(state, id)
        pop_expired(state, now, [watch | acc])
      else
        {Enum.reverse(acc), state}
      end
    end
  end

  defp sync_deadline_timer(state) do
    next_deadline =
      if :gb_trees.is_empty(state.deadlines) do
        nil
      else
        {{deadline, _id}, _value} = :gb_trees.smallest(state.deadlines)
        deadline
      end

    cond do
      next_deadline == state.deadline_timer_at ->
        state

      is_nil(next_deadline) ->
        cancel_timer(state.deadline_timer_ref)

        %{
          state
          | deadline_timer_at: nil,
            deadline_timer_ref: nil,
            deadline_timer_token: nil
        }

      true ->
        cancel_timer(state.deadline_timer_ref)
        token = make_ref()
        delay = max(0, next_deadline - monotonic_ms())
        timer_ref = Process.send_after(self(), {:multiplex_deadline, token}, delay)

        %{
          state
          | deadline_timer_at: next_deadline,
            deadline_timer_ref: timer_ref,
            deadline_timer_token: token
        }
    end
  end

  defp schedule_status_check(%State{status_check_interval: interval} = state) do
    ref = Process.send_after(self(), :multiplex_check_availability, interval)
    %{state | status_timer_ref: ref}
  end

  defp lookup(state, handle) do
    state.source.lookup(state.api, handle, state.source_opts)
  rescue
    _ -> :not_found
  catch
    _, _ -> :not_found
  end

  defp safe_subscribe(state, handle, ref) do
    state.source.subscribe(state.api, handle, ref, state.source_opts)
  rescue
    error -> {:error, error}
  catch
    kind, reason -> {:error, {kind, reason}}
  end

  defp safe_unsubscribe(state, handle) do
    state.source.unsubscribe(state.api, handle, state.source_opts)
  rescue
    _ -> :ok
  catch
    _, _ -> :ok
  end

  defp available?(state) do
    Multiplex.available?(
      state.api,
      state.source,
      state.source_opts,
      state.availability_guard
    )
  end

  defp unavailable(state) do
    frame =
      Multiplex.error_frame(
        nil,
        "inactive_instance",
        "Multiplexing is only available on the active Electric instance",
        true
      )

    {:stop, {:shutdown, :restart}, {1012, "inactive Electric instance"},
     [{:text, Jason.encode!(frame)}], state}
  end

  defp push_error(state, id, code, message, retryable) do
    push_frame(Multiplex.error_frame(id, code, message, retryable), state)
  end

  defp push_frame(frame, state), do: {:push, {:text, Jason.encode!(frame)}, state}

  defp push_frames([], state), do: {:ok, state}

  defp push_frames(frames, state) do
    messages = Enum.map(frames, &{:text, Jason.encode!(&1)})
    {:push, messages, state}
  end

  defp valid_identifier?(value) do
    is_binary(value) and byte_size(value) > 0 and byte_size(value) <= @max_identifier_bytes
  end

  defp valid_id_or_nil(id), do: if(valid_identifier?(id), do: id, else: nil)

  defp valid_cursor?(nil), do: true

  defp valid_cursor?(cursor) do
    is_binary(cursor) and byte_size(cursor) <= @max_cursor_bytes
  end

  defp cancel_timer(nil), do: :ok

  defp cancel_timer(ref) do
    Process.cancel_timer(ref)
    :ok
  end

  defp monotonic_ms, do: System.monotonic_time(:millisecond)

  defp fetch_opt!(opts, key) do
    case Access.fetch(opts, key) do
      {:ok, value} -> value
      :error -> raise KeyError, key: key, term: opts
    end
  end
end
