defmodule Electric.ShapeCache.ShapeCleaner do
  @moduledoc """
  Removes a shape (consumer, status entry, on-disk data and publication entry) on demand.
  """

  alias Electric.Shapes.Consumer
  alias Electric.ShapeCache.ShapeStatus
  alias Electric.ShapeCache.Storage
  alias Electric.ShapeCache.ShapeCleaner.CleanupTaskSupervisor
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @type shape_handle() :: Electric.shape_handle()
  @type stack_id() :: Electric.stack_id()

  @shutdown_cleanup {:shutdown, :cleanup}
  @shutdown_suspend {:shutdown, :suspend}

  # Public API
  def consumer_cleanup_reason, do: @shutdown_cleanup
  def consumer_suspend_reason, do: @shutdown_suspend

  @spec remove_shapes(stack_id(), [shape_handle()], term()) :: :ok | {:error, term()}
  def remove_shapes(stack_id, shape_handles, reason \\ @shutdown_cleanup)
      when is_list(shape_handles) do
    OpenTelemetry.with_span(
      "shape_cleaner.remove_shapes",
      [],
      stack_id,
      fn ->
        valid_handles = remove_shapes_immediate(stack_id, shape_handles, reason)
        remove_shapes_deferred(stack_id, valid_handles)
        OpenTelemetry.stop_and_save_intervals(total_attribute: "remove_shape.total_duration_µs")
        :ok
      end
    )
  end

  @spec remove_shape(stack_id(), shape_handle(), term()) :: :ok | {:error, term()}
  def remove_shape(stack_id, shape_handle, reason \\ @shutdown_cleanup) do
    remove_shapes(stack_id, List.wrap(shape_handle), reason)
  end

  @spec remove_shapes_async(stack_id(), [shape_handle()]) :: :ok
  def remove_shapes_async(stack_id, shape_handles) do
    CleanupTaskSupervisor.perform_async(stack_id, fn ->
      activate_mocked_functions_from_test_process()

      remove_shapes(stack_id, shape_handles)
    end)
  end

  @spec remove_shape_async(stack_id(), shape_handle()) :: :ok
  def remove_shape_async(stack_id, shape_handle) do
    remove_shapes_async(stack_id, List.wrap(shape_handle))
  end

  @spec remove_shapes_for_relations(list(Electric.oid_relation()), stack_id(), term()) :: :ok
  def remove_shapes_for_relations(stack_id, relations, reason \\ @shutdown_cleanup)

  def remove_shapes_for_relations(_stack_id, [], _reason) do
    :ok
  end

  def remove_shapes_for_relations(stack_id, relations, reason) do
    # We don't want for this call to be blocking because it will be called in `PublicationManager`
    # if it notices a discrepancy in the schema

    CleanupTaskSupervisor.perform_async(stack_id, fn ->
      affected_shapes = ShapeStatus.list_shape_handles_for_relations(stack_id, relations)

      Logger.notice(fn ->
        "Cleaning up all shapes for relations #{inspect(relations)}: #{length(affected_shapes)} shapes total"
      end)

      remove_shapes(stack_id, affected_shapes, reason)
    end)
  end

  @spec remove_shape_storage_async(stack_id(), [shape_handle()]) :: :ok
  def remove_shape_storage_async(_stack_id, []) do
    :ok
  end

  def remove_shape_storage_async(stack_id, shape_handles) do
    CleanupTaskSupervisor.perform_async(stack_id, fn ->
      activate_mocked_functions_from_test_process()

      stack_storage = Storage.for_stack(stack_id)

      Enum.each(shape_handles, fn shape_handle ->
        :ok = Storage.cleanup!(stack_storage, shape_handle)
      end)
    end)
  end

  @type reason() :: {:shutdown, :cleanup} | {:shutdown, :suspend} | term()
  @spec handle_writer_termination(stack_id(), shape_handle(), reason()) :: :removed | :ok
  def handle_writer_termination(stack_id, shape_handle, @shutdown_cleanup) do
    Logger.info("Removing shape #{inspect(shape_handle)}")

    remove_shape_async(stack_id, shape_handle)

    :removed
  end

  def handle_writer_termination(stack_id, shape_handle, @shutdown_suspend) do
    # deregister the consumer without removing it from the rest of the system
    # the next time a txn comes in matching this consumer it will be re-started
    # by the consumer registry as per any other lazily loaded consumer
    Electric.Shapes.ConsumerRegistry.remove_consumer(shape_handle, stack_id)
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

    Logger.notice(
      "Removing shape #{inspect(shape_handle)} due to abnormal shutdown: #{reason_message}"
    )

    remove_shape_async(stack_id, shape_handle)

    :removed
  end

  defp remove_shapes_immediate(stack_id, shape_handles, reason) when is_list(shape_handles) do
    Enum.flat_map(shape_handles, fn shape_handle ->
      OpenTelemetry.with_span(
        "shape_cleaner.remove_shapes.remove_shape_immediate",
        [shape_handle: shape_handle],
        stack_id,
        fn ->
          case remove_shape_immediate(stack_id, shape_handle, reason) do
            :ok -> [shape_handle]
            {:error, :data_removed} -> []
          end
        end
      )
    end)
  end

  defp remove_shape_immediate(stack_id, shape_handle, reason) do
    OpenTelemetry.start_interval(:"remove_shape.shape_status_remove.duration_µs")

    case Electric.ShapeCache.ShapeStatus.remove_shape(stack_id, shape_handle) do
      :ok ->
        OpenTelemetry.start_interval(:"remove_shape.shape_consumer_stop.duration_µs")

        stack_storage = Storage.for_stack(stack_id)

        with :ok <- Consumer.stop(stack_id, shape_handle, reason),
             OpenTelemetry.start_interval(:"remove_shape.storage_cleanup.duration_µs"),
             :ok <- Storage.cleanup!(stack_storage, shape_handle),
             OpenTelemetry.start_interval(:"remove_shape.shape_log_collector_remove.duration_µs"),
             :ok <-
               Electric.Replication.ShapeLogCollector.remove_shape(stack_id, shape_handle) do
          :ok
        end

      {:error, _reason} ->
        {:error, :data_removed}
    end
  end

  defp remove_shapes_deferred(stack_id, shape_handles) when is_list(shape_handles) do
    OpenTelemetry.start_interval(:"remove_shape.remove_shapes_deferred.duration_µs")
    :ok = CleanupTaskSupervisor.cleanup_async(stack_id, shape_handles)
  end

  if Mix.env() == :test do
    def activate_mocked_functions_from_test_process do
      Support.TestUtils.activate_mocked_functions_for_module(__MODULE__)
    end
  else
    def activate_mocked_functions_from_test_process, do: :noop
  end
end
