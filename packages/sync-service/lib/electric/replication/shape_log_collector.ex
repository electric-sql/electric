defmodule Electric.Replication.ShapeLogCollector do
  @moduledoc """
  The ShapeLogCollector is responsible for collecting and processing
  shape log operations and managing shape registrations.

  It consists of two main components: the Processor and the Registrator.

  The Processor handles the processing of shape log operations
  and manages the shape matching index updates.

  The Registrator batches the registration and deregistration of shapes
  to avoid overwhelming the Processor with frequent updates.
  """

  defdelegate child_spec(opts), to: __MODULE__.Supervisor
  defdelegate start_link(opts), to: __MODULE__.Supervisor
  defdelegate subscribe(stack_id, shape_handle, shape, operation), to: __MODULE__.Registrator
  defdelegate unsubscribe(stack_id, shape_handle), to: __MODULE__.Registrator
  defdelegate mark_as_ready(stack_id), to: __MODULE__.Processor
  defdelegate handle_operations(operations, stack_id), to: __MODULE__.Processor
  defdelegate notify_flushed(stack_id, shape_handle, offset), to: __MODULE__.Processor
  defdelegate active_shapes(stack_id), to: __MODULE__.Processor
end
