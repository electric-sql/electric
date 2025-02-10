defmodule Electric.Telemetry.Sampler do
  @moduledoc """
  Custom sampler that samples all spans except for specifically configured spans for which a given ratio is sampled.
  """

  require OpenTelemetry.Tracer, as: Tracer

  @behaviour :otel_sampler

  # Span names that are sampled probabilistically
  @probabilistic_span_names [
    "pg_txn.replication_client.process_x_log_data"
  ]

  @impl :otel_sampler
  def setup(%{ratio: ratio}) do
    %{sampling_probability: ratio}
  end

  @impl :otel_sampler
  def description(%{sampling_probability: sampling_probability}) do
    "Custom sampler that samples all spans except for specifically configured spans for which #{sampling_probability * 100}% are sampled."
  end

  @impl true
  def should_sample(ctx, _, _, span_name, _, _, state)
      when span_name in @probabilistic_span_names do
    if :rand.uniform() <= state.sampling_probability do
      {:record_and_sample, [], tracestate(ctx)}
    else
      {:drop, [], tracestate(ctx)}
    end
  end

  @impl true
  def should_sample(ctx, _trace_id, _links, _span_name, _span_kind, _attributes, _) do
    {:record_and_sample, [], tracestate(ctx)}
  end

  defp tracestate(ctx) do
    ctx
    |> Tracer.current_span_ctx()
    |> OpenTelemetry.Span.tracestate()
  end
end
