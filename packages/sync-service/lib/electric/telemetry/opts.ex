defmodule Electric.Telemetry.Opts do
  def schema do
    [
      instance_id: [type: :string],
      system_metrics_poll_interval: [type: :integer],
      statsd_host: [type: :string],
      prometheus?: [type: :boolean, default: false],
      call_home_telemetry?: [type: :boolean, default: false],
      otel_metrics?: [type: :boolean, default: false]
    ]
  end
end
