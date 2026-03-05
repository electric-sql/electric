defmodule Electric.ShapeCache.ExpiryManager do
  use GenServer

  alias Electric.ShapeCache.ShapeStatus
  alias Electric.StatusMonitor
  alias Electric.Telemetry.OpenTelemetry

  require Logger

  @schema NimbleOptions.new!(
            max_shapes: [type: {:or, [:non_neg_integer, nil]}, default: nil],
            period: [type: :non_neg_integer, default: 60_000],
            stack_id: [type: :string, required: true]
          )

  def name(stack_ref) do
    Electric.ProcessRegistry.name(stack_ref, __MODULE__)
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
        period: Keyword.fetch!(opts, :period)
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
    case StatusMonitor.status(state.stack_id) do
      %{shape: :up} ->
        shape_count = shape_count(state)

        if shape_count > max_shapes do
          expire_shapes(shape_count, state)
        end

      status ->
        # We do not expire shapes if the stack is not active since this may mean that
        # shapes have not fully restored yet and we don't want to expire while restoring
        # as this may cause race conditions.
        Logger.debug("Expiry check skipped due to inactive stack: #{inspect(status)}")
    end
  end

  defp expire_shapes(shape_count, state) do
    number_to_expire = shape_count - state.max_shapes
    {handles_to_expire, min_age} = least_recently_used(state, number_to_expire)

    Logger.notice(
      "Expiring #{number_to_expire} shapes as the number of shapes " <>
        "has exceeded the limit (#{state.max_shapes})"
    )

    OpenTelemetry.with_span(
      "expiry_manager.expire_shapes",
      [
        max_shapes: state.max_shapes,
        shape_count: shape_count,
        number_to_expire: number_to_expire,
        elapsed_minutes_since_use: min_age
      ],
      fn ->
        Electric.ShapeCache.ShapeCleaner.remove_shapes(state.stack_id, handles_to_expire)
      end
    )
  end

  defp least_recently_used(%{stack_id: stack_id}, number_to_expire) do
    OpenTelemetry.with_span("expiry_manager.get_least_recently_used", [], fn ->
      ShapeStatus.least_recently_used(stack_id, number_to_expire)
    end)
  end

  defp shape_count(%{stack_id: stack_id}) do
    OpenTelemetry.with_span("expiry_manager.get_shape_count", [], fn ->
      ShapeStatus.count_shapes(stack_id)
    end)
  end
end
