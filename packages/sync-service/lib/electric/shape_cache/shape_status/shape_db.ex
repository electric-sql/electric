defmodule Electric.ShapeCache.ShapeStatus.ShapeDb do
  @moduledoc """
  In-memory ETS-backed storage for shape metadata.

  Delegates to `Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory`.
  All data is ephemeral and lost on process restart.

  The previous SQLite-backed implementation lives under
  `Electric.ShapeCache.ShapeStatus.ShapeDb.Sqlite`.
  """

  @implementation Electric.ShapeCache.ShapeStatus.ShapeDb.InMemory

  @type shape_handle() :: Electric.shape_handle()
  @type stack_id() :: Electric.stack_id()

  defdelegate persistent?, to: @implementation
  defdelegate add_shape(stack_id, shape, shape_handle), to: @implementation
  defdelegate remove_shape(stack_id, shape_handle), to: @implementation
  defdelegate mark_snapshot_complete(stack_id, shape_handle), to: @implementation
  defdelegate reset(stack_id), to: @implementation
  defdelegate handle_for_shape(stack_id, shape), to: @implementation
  defdelegate handle_for_shape_critical(stack_id, shape), to: @implementation
  defdelegate shape_for_handle(stack_id, shape_handle), to: @implementation
  defdelegate list_shapes(stack_id), to: @implementation
  defdelegate list_shapes!(stack_id), to: @implementation
  defdelegate shape_handles_for_relations(stack_id, relations), to: @implementation
  defdelegate shape_handles_for_relations!(stack_id, relations), to: @implementation
  defdelegate reduce_shapes(stack_id, acc, reducer_fun), to: @implementation
  defdelegate reduce_shape_meta(stack_id, acc, reducer_fun), to: @implementation
  defdelegate count_shapes(stack_id), to: @implementation
  defdelegate count_shapes!(stack_id), to: @implementation
  defdelegate handle_exists?(stack_id, shape_handle), to: @implementation
  defdelegate validate_existing_shapes(stack_id), to: @implementation
  defdelegate explain(stack_id), to: @implementation
  defdelegate pending_buffer_size(stack_id), to: @implementation
  defdelegate statistics(stack_id), to: @implementation
end
