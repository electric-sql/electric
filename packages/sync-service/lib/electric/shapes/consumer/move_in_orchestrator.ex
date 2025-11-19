defmodule Electric.Shapes.Consumer.MoveInOrchestrator do
  @moduledoc """
  Orchestrates the complete move-in/move-out lifecycle.

  This is a high-level coordinator that Consumer calls to handle move events.
  It:
  - Queries the database for move-in data
  - Writes snapshots to storage
  - Updates the BufferingCoordinator
  - Generates move-out control messages

  Called BY Consumer, doesn't call into other coordinators (top-down).
  """

  alias Electric.Shapes.PartialModes
  alias Electric.ShapeCache.Storage
  alias Electric.Shapes.Shape.SubqueryMoves
  alias Electric.Shapes.Consumer.ConsumerContext
  alias Electric.Shapes.Consumer.MoveInOperation
  alias Electric.Shapes.Consumer.BufferingCoordinator
  alias Electric.Shapes.Shape

  @doc """
  Handles move-in events from a dependency shape.

  Queries the database and creates a MoveInOperation.

  Side effects: queries database, writes to storage
  """
  @spec handle_move_in(ConsumerContext.t(), Shape.handle(), list(term())) :: ConsumerContext.t()
  def handle_move_in(ctx, _dep_handle, []), do: ctx

  def handle_move_in(ctx, dep_handle, new_values) do
    # Form the where clause for the query
    formed_where_clause =
      SubqueryMoves.move_in_where_clause(ctx.shape, dep_handle, new_values)

    storage = ctx.storage
    name = Electric.Utils.uuid4()

    # Query database and write snapshot
    # This blocks until we have the snapshot info (for buffering decisions)
    pg_snapshot =
      Electric.ProcessRegistry.name(ctx.stack_id, Electric.StackTaskSupervisor)
      |> PartialModes.query_move_in(
        ctx.shape_handle,
        ctx.shape,
        formed_where_clause,
        stack_id: ctx.stack_id,
        results_fn: fn stream ->
          stream
          |> Stream.transform(
            fn -> [] end,
            fn [key, _] = item, acc -> {[item], [key | acc]} end,
            fn acc -> send(self(), {:acc, acc}) end
          )
          |> Storage.write_move_in_snapshot!(name, storage)

          receive(do: ({:acc, acc} -> acc))
        end,
        move_in_name: name
      )

    # Create the move-in operation
    operation = MoveInOperation.new(name, pg_snapshot)

    # Add to coordinator
    coordinator = BufferingCoordinator.add_move_in(ctx.coordinator, operation)

    %{ctx | coordinator: coordinator}
  end

  @doc """
  Completes a move-in operation when the query finishes.

  Transitions the operation from :querying to :filtering state.

  Side effects: writes to storage
  Returns: {updated_context, notification_data}
  """
  @spec complete_move_in(ConsumerContext.t(), MoveInOperation.name(), list(String.t())) ::
          {ConsumerContext.t(), {term(), term()}}
  def complete_move_in(ctx, name, key_set) do
    # Side effect: splice the stored data into the main log
    {{_, upper_bound} = bounds, writer} =
      Storage.append_move_in_snapshot_to_log!(name, ctx.writer)

    # Update coordinator (querying -> filtering)
    coordinator = BufferingCoordinator.complete_move_in(ctx.coordinator, name, key_set)

    # Return updated context and notification
    {%{ctx | writer: writer, coordinator: coordinator}, {bounds, upper_bound}}
  end

  @doc """
  Handles move-out events from a dependency shape.

  Generates a control message and writes it to storage.

  Side effects: writes to storage
  Returns: {updated_context, notification_data}
  """
  @spec handle_move_out(ConsumerContext.t(), Shape.handle(), list(term())) ::
          {ConsumerContext.t(), term()}
  def handle_move_out(ctx, _dep_handle, []), do: {ctx, nil}

  def handle_move_out(ctx, dep_handle, removed_values) do
    # Generate control message
    message =
      SubqueryMoves.make_move_out_control_message(ctx.shape, [{dep_handle, removed_values}])

    # Side effect: append to storage
    {{_, upper_bound}, writer} = Storage.append_control_message!(message, ctx.writer)

    {%{ctx | writer: writer}, {[message], upper_bound}}
  end
end
