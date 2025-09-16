defmodule Electric.ShapeCache.ExpiryManager do
  use GenServer

  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @schema NimbleOptions.new!(
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true],
            max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil]
          )

  @debounce_time_ms 50
  @debounce_finished :timeout

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
  end

  def notify_new_shape_added(stack_id) do
    GenServer.cast(name(stack_id), :notify_new_shape_added)
  end

  def start_link(opts) do
    with {:ok, opts} <- NimbleOptions.validate(opts, @schema) do
      GenServer.start_link(__MODULE__, opts, name: name(opts))
    end
  end

  def init(opts) do
    stack_id = Keyword.fetch!(opts, :stack_id)
    Process.set_label({:shape_expiry_manager, stack_id})
    Logger.metadata(stack_id: stack_id)
    Electric.Telemetry.Sentry.set_tags_context(stack_id: stack_id)

    {:ok,
     %{
       max_shapes: Keyword.fetch!(opts, :max_shapes),
       shape_status: Keyword.fetch!(opts, :shape_status)
     }}
  end

  def handle_cast(:notify_new_shape_added, state) do
    {:noreply, state, @debounce_time_ms}
  end

  def handle_info(@debounce_finished, state) do
    maybe_expire_shapes(state)
    {:noreply, state}
  end

  defp maybe_expire_shapes(%{max_shapes: max_shapes} = state) when max_shapes != nil do
    shape_count = shape_count(state)

    if shape_count > max_shapes do
      number_to_expire = shape_count - max_shapes

      shapes_to_expire = least_recently_used(state, number_to_expire)

      OpenTelemetry.with_span(
        "expiry_manager.expire_shapes",
        [
          max_shapes: max_shapes,
          shape_count: shape_count,
          number_to_expire: number_to_expire
        ],
        fn ->
          shapes_to_expire
          |> Enum.each(fn shape -> expire_shape(shape, state) end)
        end
      )
    end
  end

  defp maybe_expire_shapes(_), do: :ok

  defp expire_shape(shape, state) do
    OpenTelemetry.with_span(
      "expiry_manager.expire_shape",
      [
        shape_handle: shape.shape_handle,
        elapsed_minutes_since_use: shape.elapsed_minutes_since_use
      ],
      fn ->
        Logger.info(
          "Expiring shape #{shape.shape_handle} as as the number of shapes " <>
            "has exceeded the limit (#{state.max_shapes})"
        )

        clean_up_shape(state, shape.shape_handle)
      end
    )
  end

  defp clean_up_shape(state, shape_handle) do
    # remove the shape immediately so new clients are redirected elsewhere
    deregister_shape(shape_handle, state)

    OpenTelemetry.with_span(
      "expiry_manager.stop_shape_consumer",
      [shape_handle: shape_handle],
      fn ->
        Electric.Shapes.DynamicConsumerSupervisor.stop_shape_consumer(
          state.consumer_supervisor,
          state.stack_id,
          shape_handle
        )
      end
    )

    :ok
  end

  defp deregister_shape(shape_handle, %{shape_status: {shape_status, shape_status_state}}) do
    shape_status.remove_shape(shape_status_state, shape_handle)
  end

  defp least_recently_used(%{shape_status: {shape_status, shape_status_state}}, number_to_expire) do
    OpenTelemetry.with_span("expiry_manager.get_least_recently_used", [], fn ->
      shape_status.least_recently_used(shape_status_state, number_to_expire)
    end)
  end

  defp shape_count(%{shape_status: {shape_status, shape_status_state}}) do
    OpenTelemetry.with_span("expiry_manager.get_shape_count", [], fn ->
      shape_status_state
      |> shape_status.list_shapes()
      |> length()
    end)
  end
end
