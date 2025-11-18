defmodule ElectricTelemetry do
  def scheduler_ids do
    num_schedulers = :erlang.system_info(:schedulers)
    Enum.map(1..num_schedulers, &:"normal_#{&1}") ++ [:cpu, :io]
  end

  @opts_schema NimbleOptions.new!(ElectricTelemetry.Opts.schema())

  def validate_options(user_opts) do
    with {:ok, validated_opts} <- NimbleOptions.validate(user_opts, @opts_schema) do
      config =
        Map.new(validated_opts, fn
          {k, kwlist} when k in [:reporters, :intervals_and_thresholds] -> {k, Map.new(kwlist)}
          kv -> kv
        end)

      {:ok, config}
    end
  end

  def export_enabled?(%{reporters: reporters}) do
    truthy?(
      reporters.statsd_host ||
        reporters.call_home_url ||
        reporters.otel_metrics? ||
        reporters.prometheus?
    )
  end

  defp truthy?(false), do: false
  defp truthy?(nil), do: false
  defp truthy?(_), do: true
end
