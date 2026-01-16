defmodule ElectricTelemetry.MixProject do
  use Mix.Project

  def project do
    [
      app: :electric_telemetry,
      version: version(),
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      test_coverage: [tool: ExCoveralls]
    ]
  end

  def application do
    [extra_applications: [:logger, :os_mon, :runtime_tools]]
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
      {:bypass, "~> 2.1", only: [:test]},
      {:dialyxir, "~> 1.4", only: [:test], runtime: false},
      {:ex_doc, ">= 0.0.0", only: :dev, runtime: false},
      {:ex_json_schema, "~> 0.10", only: [:test]},
      {:excoveralls, "~> 0.18", only: [:test], runtime: false},
      {:jason, "~> 1.4"},
      {:junit_formatter, "~> 3.4", only: [:test], runtime: false}
    ]
  end

  defp version(default \\ "0.0.0") do
    with :error <- version_from_package_json() do
      default
    end
  end

  defp version_from_package_json do
    case File.read("./package.json") do
      {:ok, binary} -> binary |> :json.decode() |> Map.fetch!("version")
      {:error, _} -> :error
    end
  end
end
