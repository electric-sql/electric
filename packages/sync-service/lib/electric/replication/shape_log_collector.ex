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

  @doc """
  Adds a shape to the shape matching index in the ShapeLogCollector
  used for matching and sending replication stream operations.
  """
  defdelegate add_shape(stack_id, shape_handle, shape, operation), to: __MODULE__.Registrator

  @doc """
  Removes a shape from the shape matching index in the ShapeLogCollector.
  This call succeeds before the shape is actually removed from the index.
  """
  defdelegate remove_shape(stack_id, shape_handle), to: __MODULE__.Registrator

  @doc """
  Marks the collector as ready to process operations from
  the replication stream.

  This is typically called after the initial shape registrations
  have been processed.
  """
  defdelegate mark_as_ready(stack_id), to: __MODULE__.Processor

  @doc """
  Handles a batch of shape log operations.

  Should be called with operations received from the replication stream.
  """
  defdelegate handle_operations(operations, stack_id), to: __MODULE__.Processor

  @doc """
  Notifies the ShapeLogCollector that a shape's data has been flushed
  up to a certain offset, used to mark the overall flush progress.

  Should be called by consumer processes after they flush data.
  """
  defdelegate notify_flushed(stack_id, shape_handle, offset), to: __MODULE__.Processor

  @doc """
  Returns the list of currently active shapes being tracked
  in the shape matching filters.
  """
  defdelegate active_shapes(stack_id), to: __MODULE__.Processor
end
