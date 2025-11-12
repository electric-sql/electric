defmodule Electric.ShapeCache.ShapeCleaner do
  @moduledoc """
  Removes a shape (consumer, status entry, on-disk data and publication entry) on demand.

  This process ensures removing of shapes does not block critical path of shape creation.
  """

  # use GenServer

  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @type shape_handle() :: Electric.ShapeCacheBehaviour.shape_handle()
  @type stack_id() :: Electric.stack_id()

  # Public API
  def child_spec(args) do
    CleanupTaskSupervisor.child_spec(args)
  end

  @spec remove_shape(stack_id(), shape_handle()) :: :ok | {:error, term()}
  def remove_shape(stack_id, shape_handle, reason \\ {:shutdown, :cleanup}) do
    OpenTelemetry.with_span(
      "shape_cleaner.remove_shape",
      [shape_handle: shape_handle],
      stack_id,
      fn ->
        Logger.debug("Removing shape #{inspect(shape_handle)}")

        OpenTelemetry.start_interval("remove_shape.remove_shape_immediate")

        case remove_shape_immediate(stack_id, shape_handle, reason) do
          :ok ->
            OpenTelemetry.start_interval("remove_shape.remove_shape_deferred")
            remove_shape_deferred(stack_id, shape_handle)

          {:error, :shape_gone} ->
            :ok
        end
        |> tap(fn _ ->
          OpenTelemetry.stop_and_save_intervals(total_attribute: "remove_shape.total_duration_µs")
        end)
      end
    )
  end

  @spec remove_shape_async(stack_id(), shape_handle()) :: :ok
  def remove_shape_async(stack_id, shape_handle) do
    CleanupTaskSupervisor.perform_async(stack_id, fn ->
      remove_shape(stack_id, shape_handle)
    end)
  end

  @spec remove_shapes_for_relations(list(Electric.oid_relation()), stack_id(), term()) :: :ok
  def remove_shapes_for_relations(stack_id, relations, reason \\ {:shutdown, :cleanup})

  def remove_shapes_for_relations(_stack_id, [], _reason) do
    :ok
  end

  def remove_shapes_for_relations(stack_id, relations, reason) do
    # We don't want for this call to be blocking because it will be called in `PublicationManager`
    # if it notices a discrepancy in the schema

    CleanupTaskSupervisor.perform_async(stack_id, fn ->
      affected_shapes = ShapeStatus.list_shape_handles_for_relations(stack_id, relations)

      Logger.info(fn ->
        "Cleaning up all shapes for relations #{inspect(relations)}: #{length(affected_shapes)} shapes total"
      end)

      Enum.each(affected_shapes, fn shape_handle ->
        remove_shape(stack_id, shape_handle, reason)
      end)
    end)
  end

  def handle_writer_termination(_stack_id, _shape_handle, reason)
      when reason in [:normal, :killed, :shutdown] or
             (is_tuple(reason) and elem(reason, 0) == :shutdown) do
    :ok
  end

  def handle_writer_termination(stack_id, shape_handle, reason) do
    reason_message =
      case reason do
        {error, stacktrace} when is_tuple(error) and is_list(stacktrace) ->
          Exception.format(:error, error, stacktrace)

        other ->
          inspect(other)
      end

    Logger.info(
      "Removing shape #{inspect(shape_handle)} due to abnormal shutdown: #{reason_message}"
    )

    remove_shape(stack_id, shape_handle)

    :removed
  end

  defp remove_shape_immediate(stack_id, shape_handle, reason) do
    OpenTelemetry.start_interval("remove_shape.shape_status_remove")

    case Electric.ShapeCache.ShapeStatus.remove_shape(stack_id, shape_handle) do
      {:ok, _shape} ->
        OpenTelemetry.start_interval("remove_shape.shape_consumer_stop")

        stack_storage = Storage.for_stack(stack_id)

        with result when result in [:noproc, :ok] <-
               Consumer.stop(stack_id, shape_handle, reason),
             OpenTelemetry.start_interval("remove_shape.storage_cleanup"),
             :ok <- Storage.cleanup!(stack_storage, shape_handle),
             OpenTelemetry.start_interval("remove_shape.shape_log_collector_remove"),
             :ok <- Electric.Replication.ShapeLogCollector.remove_shape(stack_id, shape_handle) do
          :ok
        end

      {:error, _reason} ->
        {:error, :shape_gone}
    end
  end

  defp remove_shape_deferred(stack_id, shape_handle) do
    :ok = CleanupTaskSupervisor.cleanup_async(stack_id, shape_handle)
  end
end
