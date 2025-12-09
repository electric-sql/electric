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
    name = Electric.Utils.uuid4()
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

        # Process query results
        stream
        |> Stream.transform(
          fn -> [] end,
          fn [key, _, _] = item, acc -> {[item], [key | acc]} end,
          fn acc -> send(task_pid, {:acc, acc, pg_snapshot}) end
        )
        |> Storage.write_move_in_snapshot!(name, storage)

        # Return accumulated keys and snapshot
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
    move_handling_state =
      MoveIns.move_out_happened(
        state.move_handling_state,
        MapSet.new(message.headers.patterns |> Enum.map(& &1[:value]))
      )

    {{_, upper_bound}, writer} = Storage.append_control_message!(message, state.writer)

    {%{state | move_handling_state: move_handling_state, writer: writer},
     {[message], upper_bound}}
  end

  def query_complete(%State{} = state, name, key_set, snapshot) do
    # 1. Splice stored snapshot into main log with filtering
    {{lower_bound, upper_bound}, writer} =
      Storage.append_move_in_snapshot_to_log_filtered!(
        name,
        state.writer,
        state.move_handling_state.touch_tracker,
        snapshot,
        state.move_handling_state.moved_out_tags[name] || MapSet.new()
      )

    # 2. Move from "waiting" to "filtering"
    {visibility_snapshot, move_handling_state} =
      MoveIns.change_to_filtering(state.move_handling_state, name, MapSet.new(key_set))

    {{_, upper_bound}, writer} =
      if is_nil(visibility_snapshot) do
        {{nil, upper_bound}, writer}
      else
        append_snapshot_end_control(snapshot, writer)
      end

    state = %{state | move_handling_state: move_handling_state, writer: writer}

    {state, {{lower_bound, upper_bound}, upper_bound}}
  end

  @spec append_snapshot_end_control(MoveIns.pg_snapshot(), Storage.writer_state()) ::
          {{LogOffset.t(), LogOffset.t()}, Storage.writer_state()}
  defp append_snapshot_end_control({xmin, xmax, xip_list}, writer) do
    control_message = %{
      headers: %{
        control: "snapshot-end",
        xmin: Integer.to_string(xmin),
        xmax: Integer.to_string(xmax),
        xip_list: Enum.map(xip_list, &Integer.to_string/1)
      }
    }

    Storage.append_control_message!(control_message, writer)
  end
end
