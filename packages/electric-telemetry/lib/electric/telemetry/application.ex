defmodule Electric.Telemetry.Application do
  use Application

  def start(_type, _args) do
    otel_opts = Application.get_env(:electric_telemetry, :otel_opts, [])

    if otel_opts != [] do
      # We must populate otel_metric_exporter's app env because that's where its LogHandler
      # will be looking for OTLP-specific configuration options. This config will also be used
      # by the metric exporter.
      Application.put_all_env(otel_metric_exporter: otel_opts)
    end

    # Start a dummy supervisor to satisfy the `start/2` callback's requirements
    Supervisor.start_link([], strategy: :one_for_one)
  end
end
