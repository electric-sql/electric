defmodule Electric.Shapes.Consumer.MoveHandling do
  @moduledoc false
  alias Electric.Replication.LogOffset
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Consumer.State
  alias Electric.Shapes.PartialModes
  alias Electric.Shapes.Shape
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.MoveIns

  require Logger

  @spec process_move_ins(State.t(), Shape.handle(), list(term())) :: State.t()
  def process_move_ins(state, _, []), do: state

  def process_move_ins(%State{} = state, dep_handle, new_values) do
    # Something moved in in a dependency shape. We need to query the DB for relevant values.
    formed_where_clause =
      Shape.SubqueryMoves.move_in_where_clause(
        state.shape,
        dep_handle,
        Enum.map(new_values, &elem(&1, 1))
      )

    storage = state.storage
    name = Electric.Utils.uuid4() <> "-" <> inspect(Enum.map(new_values, &elem(&1, 1)))
    consumer_pid = self()

    # Start async query - don't block on snapshot
    Electric.ProcessRegistry.name(state.stack_id, Electric.StackTaskSupervisor)
    |> PartialModes.query_move_in_async(
      state.shape_handle,
      state.shape,
      formed_where_clause,
      stack_id: state.stack_id,
      consumer_pid: consumer_pid,
      results_fn: fn stream, pg_snapshot ->
        task_pid = self()

        # Process query results, accumulating {key, tags} pairs
        stream
        |> Stream.transform(
          fn -> [] end,
          fn [key, tags, _] = item, acc -> {[item], [{key, tags} | acc]} end,
          fn acc -> send(task_pid, {:acc, acc, pg_snapshot}) end
        )
        |> Storage.write_move_in_snapshot!(name, storage)

        # Return accumulated key-tag pairs and snapshot
        receive(do: ({:acc, acc, snapshot} -> {acc, snapshot}))
      end,
      move_in_name: name
    )

    index = Enum.find_index(state.shape.shape_dependencies_handles, &(&1 == dep_handle))

    # Add to waiting WITHOUT blocking (snapshot will be set later via message)
    move_handling_state =
      MoveIns.add_waiting(
        state.move_handling_state,
        name,
        {["$sublink", Integer.to_string(index)], MapSet.new(Enum.map(new_values, &elem(&1, 0)))}
      )

    Logger.debug("Move-in #{name} has been triggered from #{dep_handle}")

    %{state | move_handling_state: move_handling_state}
  end

  @spec process_move_outs(State.t(), Shape.handle(), list(term())) ::
          {State.t(), changes :: term()}
  def process_move_outs(state, _, []), do: {state, nil}

  def process_move_outs(state, dep_handle, removed_values) do
    message =
      SubqueryMoves.make_move_out_control_message(
        state.shape,
        state.stack_id,
        state.shape_handle,
        [
          {dep_handle, removed_values}
        ]
      )

    # TODO: This leaks the message abstraction, and I'm OK with it for now because I'll be refactoring this code path for the multi-subqueries shortly
    index = Enum.find_index(state.shape.shape_dependencies_handles, &(&1 == dep_handle))
    removed_values_set = MapSet.new(Enum.map(removed_values, &elem(&1, 0)))

    move_handling_state =
      MoveIns.move_out_happened(
        state.move_handling_state,
        MapSet.new(message.headers.patterns |> Enum.map(& &1[:value])),
        {["$sublink", Integer.to_string(index)], removed_values_set}
      )

    {{_, upper_bound}, writer} = Storage.append_control_message!(message, state.writer)

    state = %{state | move_handling_state: move_handling_state, writer: writer}

    {state, {[message], upper_bound}}
  end

  @doc """
  Buffer a completed move-in query result for snapshot-ordered splice.
  [P.splice]: Results are NOT spliced immediately. They are buffered and will be
  spliced just before the first observed WAL transaction that is NOT visible in
  the query snapshot, or when a global LSN acknowledgement triggers it.
  """
  def buffer_query_result(%State{} = state, name, key_tag_pairs, snapshot) do
    move_handling_state =
      MoveIns.buffer_completed_move_in(
        state.move_handling_state,
        name,
        key_tag_pairs,
        snapshot
      )

    %{state | move_handling_state: move_handling_state}
  end

  @doc """
  [P.splice] Primary trigger: splice buffered move-ins whose query snapshot
  does NOT cover the given xid. Called just before processing each WAL txn.
  """
  def splice_buffered_before_txn(%State{} = state, xid) do
    {ready, move_handling_state} =
      MoveIns.pop_ready_to_splice_before_txn(state.move_handling_state, xid)

    state = %{state | move_handling_state: move_handling_state}
    splice_all(state, ready)
  end

  @doc """
  [P.splice] Secondary trigger: splice buffered move-ins whose query WAL LSN
  is <= the given global LSN. Called when global acknowledgement arrives.
  """
  def splice_buffered_by_lsn(%State{} = state, lsn) do
    {ready, move_handling_state} =
      MoveIns.pop_ready_to_splice_by_lsn(state.move_handling_state, lsn)

    state = %{state | move_handling_state: move_handling_state}
    splice_all(state, ready)
  end

  defp splice_all(state, []), do: {state, nil}

  defp splice_all(state, entries) do
    Enum.reduce(entries, {state, nil}, fn {name, key_tag_pairs, snapshot, _key_set},
                                          {state, prev_notification} ->
      {state, notification} = splice_move_in(state, name, key_tag_pairs, snapshot)
      {state, merge_notifications(prev_notification, notification)}
    end)
  end

  defp merge_notifications(nil, notification), do: notification

  defp merge_notifications(
         {{prev_lower, _prev_upper}, _prev_latest},
         {{_new_lower, new_upper}, _new_latest}
       ) do
    {{prev_lower, new_upper}, new_upper}
  end

  defp splice_move_in(%State{} = state, name, key_tag_pairs, _snapshot) do
    # Get the trigger generation, moved_out_tags, and MI filter keys before transitioning state.
    # MI filter keys must be captured before change_to_filtering, which removes the entry.
    moved_out_tags = state.move_handling_state.moved_out_tags[name] || MapSet.new()

    # key_tag_pairs is a list of {key, tags} tuples from results_fn.
    # Extract just the keys for change_to_filtering.
    key_set = Enum.map(key_tag_pairs, fn {key, _tags} -> key end)

    # 1. Move from "waiting" to "filtering" to get trigger generation
    {move_in_snapshot, _moved_values, _trigger_gen, _move_in_id, _wal_lsn} =
      Map.fetch!(state.move_handling_state.waiting_move_ins, name)

    # 2. Splice stored snapshot into main log with filtering.
    # The skip_row? predicate closes over per-MI moved_out tags and shadow
    # state so that storage doesn't need to know about move-in domain logic.
    # A row is skipped if all its tags were moved out or if the key is already
    # shadowed for this MI.
    skip_row? = fn key, tags ->
      (tags != [] and Enum.all?(tags, &MapSet.member?(moved_out_tags, &1))) or
        MoveIns.key_already_shadowed_for_move_in?(
          state.move_handling_state,
          key,
          name
        )
    end

    actually_inserted =
      Enum.filter(key_tag_pairs, fn {key, tags} ->
        not skip_row?.(key, tags)
      end)

    {visibility_snapshot, _trigger_gen, _move_in_id, move_handling_state} =
      MoveIns.change_to_filtering(state.move_handling_state, name, MapSet.new(key_set))

    {{lower_bound, upper_bound}, writer} =
      Storage.append_move_in_snapshot_to_log!(
        name,
        state.writer,
        skip_row?
      )

    # 3. Compute actually-inserted keys by replicating the splice's filtering.

    actually_inserted_keys = Enum.map(actually_inserted, fn {key, _tags} -> key end)

    # Update the filtering_move_ins key_set to only include actually-inserted keys.
    move_handling_state =
      MoveIns.update_latest_filtering_key_set(
        move_handling_state,
        MapSet.new(actually_inserted_keys)
      )

    {{_, upper_bound}, writer} =
      if is_nil(visibility_snapshot) do
        {{nil, upper_bound}, writer}
      else
        append_snapshot_end_control(move_in_snapshot, name, writer)
      end

    state = %{state | move_handling_state: move_handling_state, writer: writer}

    {state, {{lower_bound, upper_bound}, upper_bound}}
  end

  @spec append_snapshot_end_control(MoveIns.pg_snapshot(), String.t(), Storage.writer_state()) ::
          {{LogOffset.t(), LogOffset.t()}, Storage.writer_state()}
  defp append_snapshot_end_control({xmin, xmax, xip_list}, move_in_name, writer) do
    control_message = %{
      headers: %{
        control: "snapshot-end",
        xmin: Integer.to_string(xmin),
        xmax: Integer.to_string(xmax),
        xip_list: Enum.map(xip_list, &Integer.to_string/1),
        move_in_name: move_in_name
      }
    }

    Storage.append_control_message!(control_message, writer)
  end
end
