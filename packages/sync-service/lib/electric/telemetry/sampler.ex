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
  def should_sample(ctx, _trace_id, _links, span_name, _span_kind, _attributes, %{
        sampling_probability: sampling_probability
      }) do
    tracestate = Tracer.current_span_ctx(ctx) |> OpenTelemetry.Span.tracestate()

    if span_name in @probabilistic_span_names do
      if :rand.uniform() <= sampling_probability do
        {:record_and_sample, [], tracestate}
      else
        {:drop, [], tracestate}
      end
    else
      # Always sample other spans
      {:record_and_sample, [], tracestate}
    end
  end
end
