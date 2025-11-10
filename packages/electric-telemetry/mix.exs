defmodule Electric.Telemetry.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric_telemetry,
      version: "0.1.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps()
    ]
  end

  def application do
    [
      extra_applications: [:logger, :os_mon, :runtime_tools],
      mod: {Electric.Telemetry.Application, []}
    ]
  end

  defp deps do
    List.flatten(
      [
        {:otel_metric_exporter, "~> 0.4.1"},
        {:req, "~> 0.5"},
        {:telemetry, "~> 1.3"},
        {:telemetry_metrics, "~> 1.1"},
        {:telemetry_metrics_prometheus_core, "~> 1.2"},
        {:telemetry_metrics_statsd, "~> 0.7"},
        {:telemetry_poller, "~> 1.3"}
      ],
      dev_and_test_deps()
    )
  end

  defp dev_and_test_deps do
    [
      {:dialyxir, "~> 1.4", only: [:test], runtime: false},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false},
      {:junit_formatter, "~> 3.4", only: [:test], runtime: false},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false}
    ]
  end
end
