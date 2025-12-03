defmodule Electric.Replication.ShapeLogCollector do
  defdelegate child_spec(opts), to: __MODULE__.Supervisor
  defdelegate start_link(opts), to: __MODULE__.Supervisor
  defdelegate subscribe(stack_id, shape_handle, shape, operation), to: __MODULE__.Registrator
  defdelegate remove_shape(stack_id, shape_handle), to: __MODULE__.Registrator
  defdelegate mark_as_ready(server_ref), to: __MODULE__.Processor
  defdelegate handle_operations(operations, server), to: __MODULE__.Processor
  defdelegate notify_flushed(server_ref, shape_handle, offset), to: __MODULE__.Processor
  defdelegate active_shapes(server_ref), to: __MODULE__.Processor
end
