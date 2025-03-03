defmodule Electric.Telemetry.Opts do
  def schema do
    [
      instance_id: [type: :string],
      system_metrics_poll_interval: [type: :integer, default: :timer.seconds(5)],
      statsd_host: [type: {:or, [:string, nil]}, default: nil],
      prometheus?: [type: :boolean, default: false],
      call_home_telemetry?: [type: :boolean, default: false],
      otel_metrics?: [type: :boolean, default: false],
      otel_export_period: [type: :integer, default: :timer.seconds(30)],
      otel_per_process_metrics?: [type: :boolean, default: false],
      top_process_count: [type: :integer, default: 5]
    ]
  end
end
