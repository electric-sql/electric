defmodule Electric.ShapeCache.ExpiryManager do
  use GenServer

  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @name_schema_tuple {:tuple, [:atom, :atom, :any]}
  @genserver_name_schema {:or, [:atom, @name_schema_tuple]}
  @schema NimbleOptions.new!(
            max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil],
            expiry_batch_size: [type: :pos_integer],
            period: [type: :non_neg_integer, default: 60_000],
            stack_id: [type: :string, required: true],
            shape_status: [type: :mod_arg, required: true],
            consumer_supervisor: [type: @genserver_name_schema, required: true]
          )

  def name(stack_id) when not is_map(stack_id) and not is_list(stack_id) do
    Electric.ProcessRegistry.name(stack_id, __MODULE__)
  end

  def name(opts) do
    stack_id = Access.fetch!(opts, :stack_id)
    name(stack_id)
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

    state =
      %{
        stack_id: stack_id,
        max_shapes: Keyword.fetch!(opts, :max_shapes),
        expiry_batch_size: Keyword.fetch!(opts, :expiry_batch_size),
        period: Keyword.fetch!(opts, :period),
        shape_status: Keyword.fetch!(opts, :shape_status),
        consumer_supervisor: Keyword.fetch!(opts, :consumer_supervisor)
      }

    if not is_nil(state.max_shapes), do: schedule_next_check(state)

    {:ok, state}
  end

  defp schedule_next_check(state) do
    Process.send_after(self(), :maybe_expire_shapes, state.period)
  end

  def handle_info(:maybe_expire_shapes, state) do
    maybe_expire_shapes(state)
    schedule_next_check(state)
    {:noreply, state}
  end

  defp maybe_expire_shapes(%{max_shapes: nil}), do: :ok

  defp maybe_expire_shapes(%{max_shapes: max_shapes} = state) do
    shape_count = shape_count(state)

    if shape_count > max_shapes do
      expire_shapes(shape_count, state)
    end
  end

  defp expire_shapes(shape_count, state) do
    shapes_to_expire = least_recently_used(state, state.expiry_batch_size)

    Logger.info(
      "Expiring #{length(shapes_to_expire)} shapes as the number of shapes " <>
        "has exceeded the limit (#{state.max_shapes})"
    )

    OpenTelemetry.with_span(
      "expiry_manager.expire_shapes",
      [
        max_shapes: state.max_shapes,
        shape_count: shape_count,
        number_to_expire: state.expiry_batch_size
      ],
      fn -> Enum.each(shapes_to_expire, &expire_shape(&1, state)) end
    )
  end

  defp expire_shape(shape, state) do
    OpenTelemetry.with_span(
      "expiry_manager.expire_shape",
      [
        shape_handle: shape.shape_handle,
        elapsed_minutes_since_use: shape.elapsed_minutes_since_use
      ],
      fn ->
        Electric.Shapes.ShapeCleaner.remove_shape(shape.shape_handle, stack_id: state.stack_id)
      end
    )
  end

  defp least_recently_used(%{shape_status: {shape_status, shape_status_state}}, number_to_expire) do
    OpenTelemetry.with_span("expiry_manager.get_least_recently_used", [], fn ->
      shape_status.least_recently_used(shape_status_state, number_to_expire)
    end)
  end

  defp shape_count(%{shape_status: {shape_status, shape_status_state}}) do
    OpenTelemetry.with_span("expiry_manager.get_shape_count", [], fn ->
      shape_status.count_shapes(shape_status_state)
    end)
  end
end
