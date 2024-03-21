defmodule Electric.Satellite.Protocol.Telemetry do
  alias Electric.Replication.Shapes.ShapeRequest
  alias Electric.Telemetry.Metrics
  alias Electric.Satellite.Protocol.State

  defstruct connection_span: nil,
            replication_span: nil,
            subscription_spans: %{}

  @type t() :: %__MODULE__{
          connection_span: Metrics.t(),
          replication_span: Metrics.t() | nil,
          subscription_spans: %{optional(subscription_id :: String.t()) => Metrics.t()}
        }

  @spec start_replication_span(State.t(), :initial_sync | [{:subscriptions, non_neg_integer()}]) ::
          State.t()
  def start_replication_span(%State{} = state, opts) do
    {subscriptions, initial_sync} =
      case opts do
        :initial_sync -> {0, true}
        [subscriptions: n] when is_integer(n) -> {n, false}
      end

    span =
      Metrics.start_child_span(
        state.telemetry.connection_span,
        [:satellite, :replication],
        %{continued_subscriptions: subscriptions},
        Map.put(common_metadata(state), :initial_sync, initial_sync)
      )

    put_in(state.telemetry.replication_span, span)
  end

  @spec start_subscription_span(State.t(), String.t(), [ShapeRequest.t()]) :: State.t()
  def start_subscription_span(%State{telemetry: telemetry} = state, id, requests) do
    {included_tables, {total_requests, hashes}} =
      Enum.flat_map_reduce(requests, {0, []}, fn %ShapeRequest{} = req, {total, hashes} ->
        {ShapeRequest.included_tables(req), {total + 1, [req.hash | hashes]}}
      end)

    %__MODULE__{replication_span: parent} = telemetry

    measurements = %{
      included_tables: length(Enum.uniq(included_tables)),
      shapes: total_requests
    }

    metadata =
      state
      |> common_metadata()
      |> Map.put(:shape_hashes, hashes)
      |> Map.put(:subscription_id, id)

    span =
      Metrics.start_child_span(
        parent,
        [:satellite, :replication, :new_subscription],
        measurements,
        metadata
      )

    put_in(state.telemetry.subscription_spans[id], span)
  end

  @spec subscription_data_ready(State.t(), String.t()) :: State.t()
  def subscription_data_ready(%State{} = state, id) do
    put_in(
      state.telemetry.subscription_spans[id].intermediate_measurements[
        :data_ready_monotonic_time
      ],
      System.monotonic_time()
    )
  end

  @spec stop_subscription_span(State.t(), String.t()) :: State.t()
  def stop_subscription_span(%State{telemetry: telemetry} = state, id) do
    {span, telemetry} = pop_in(telemetry.subscription_spans[id])
    monotonic_time = System.monotonic_time()
    data_time = span.intermediate_measurements.data_ready_monotonic_time

    Metrics.stop_span(span, %{
      monotonic_time: monotonic_time,
      data_ready_monotonic_time: data_time,
      data_ready_duration: data_time - span.start_time,
      send_lag: monotonic_time - data_time
    })

    %State{state | telemetry: telemetry}
  end

  @spec get_subscription_span(State.t(), String.t()) :: Metrics.t() | nil
  def get_subscription_span(%State{telemetry: %__MODULE__{subscription_spans: spans}}, id),
    do: Map.get(spans, id, nil)

  def event(%State{} = state, event, measurements \\ %{}, metadata \\ %{}) do
    Metrics.untimed_span_event(
      state.telemetry.replication_span,
      event,
      measurements,
      Map.merge(common_metadata(state), metadata)
    )
  end

  defp common_metadata(%State{} = state) do
    %{client_id: state.client_id, user_id: state.auth && state.auth.user_id}
  end
end
