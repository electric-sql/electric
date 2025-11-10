defmodule Electric.Telemetry.Opts do
  def schema do
    [
      instance_id: [type: :string, required: true],
      installation_id: [type: :string],
      stack_id: [type: :string],
      version: [type: :string, required: true],
      reporters: [
        type: :keyword_list,
        default: [],
        keys: [
          statsd_host: [type: {:or, [:string, nil]}, default: nil],
          call_home_url: [type: {:or, [:string, {:struct, URI}, nil]}, default: nil],
          otel_metrics?: [type: :boolean, default: false],
          prometheus?: [type: :boolean, default: false],
          otel_resource_attributes: [type: :map, default: %{}]
        ]
      ],
      intervals_and_thresholds: [
        type: :keyword_list,
        keys: [
          system_metrics_poll_interval: [type: :integer, default: :timer.seconds(5)],
          top_process_count: [type: :integer, default: 5],
          long_gc_threshold: [type: :integer, default: 500],
          long_schedule_threshold: [type: :integer, default: 500],
          long_message_queue_enable_threshold: [type: :integer, default: 1000],
          long_message_queue_disable_threshold: [type: :integer, default: 100]
        ]
      ],
      periodic_measurements: [
        type:
          {:list,
           {:or,
            [
              {:in,
               [:builtin, :memory, :persistent_term, :system_counts, :total_run_queue_lengths]},
              :atom,
              :mfa,
              {:fun, 1}
            ]}},
        required: false
      ],
      additional_metrics: [
        type:
          {:list,
           {:or,
            [
              {:struct, Telemetry.Metrics.Counter},
              {:struct, Telemetry.Metrics.LastValue},
              {:struct, Telemetry.Metrics.Sum},
              {:struct, Telemetry.Metrics.Summary},
              {:struct, Telemetry.Metrics.Distribution}
            ]}}
      ],
      otel_opts: [
        type: :keyword_list,
        keys: [
          otlp_protocol: [type: {:in, [:http_protobuf]}, default: :http_protobuf],
          otlp_compression: [type: {:in, [:gzip]}, default: :gzip],
          # The otlp_endpoint option is actually required but we rely on OtelMetricExporter
          # fetching it from the app env if it's not passed explicitly.
          otlp_endpoint: [type: :string],
          otlp_headers: [type: :map, default: %{}],
          export_period: [type: :integer, default: :timer.seconds(30)],
          resource: [type: :map, default: %{}]
        ]
      ]
    ]
  end
end
