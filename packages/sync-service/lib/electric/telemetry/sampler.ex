defmodule Electric.Telemetry.Sampler do
  @moduledoc """
  Decides which spans should be included and how often.

  This deviates from the standard way to OpenTelemetry sampling by sampling as the spans are created.
  This is done to avoid the overhead of creating spans that will not be recorded.

  Child spans of a sampled span should use `OpenTelemetry.with_child_span/4` to ensure that
  they are only sampled if the parent span is sampled.
  """

  def include_span?(name) do
    !excluded?(name) && included?(name)
  end

  defp included?("filter." <> _), do: Application.get_env(:electric, :profile_where_clauses?)
  defp included?("pg_txn.replication_client.transaction_received"), do: sample?()
  defp included?(_), do: true

  defp excluded?(name) do
    case Electric.Config.get_env(:exclude_spans) do
      nil -> false
      set -> MapSet.member?(set, name)
    end
  end

  defp sample? do
    :rand.uniform() <= Electric.Config.get_env(:otel_sampling_ratio)
  end

  def sample_metrics? do
    :rand.uniform() <= Electric.Config.get_env(:metrics_sampling_ratio)
  end
end
