defmodule Electric.Telemetry.Sampler do
  @moduledoc """
  Decides which spans should be included and how often.

  This deviates from the standard way to OpenTelemetry sampling by sampling as the spans are created.
  This is done to avoid the overhead of creating spans that will not be recorded.

  Child spans of a sampled span should use `OpenTelemetry.with_child_span/4` to ensure that
  they are only sampled if the parent span is sampled.
  """

  def include_span?("filter." <> _), do: Application.get_env(:electric, :profile_where_clauses?)
  def include_span?("pg_txn.replication_client.transaction_received"), do: sample?()
  def include_span?(_), do: true

  def sample? do
    :rand.uniform() <= Electric.Config.get_env(:otel_sampling_ratio)
  end
end
