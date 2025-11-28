defmodule ElectricTelemetry.Opts do
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
        default: [],
        keys: [
          system_metrics_poll_interval: [type: :integer, default: :timer.seconds(5)],
          top_process_count: [type: :integer, default: 5],
          # Garbage collection should run almost instantly since each process has its own heap that
          # is garbage collected independently of others. 50ms might be too generous.
          long_gc_threshold: [type: :integer, default: 50],
          # A process generally runs for 1ms at a time. Erlang docs mention that 100ms should be
          # expected in a realistic production setting. So we tentatively set it to 150ms.
          long_schedule_threshold: [type: :integer, default: 150],
          # All processes generally have 0 message waiting in the message queue. If a process starts
          # lagging behind and reaches 10 pending messages, something's going seriously wrong in the
          # VM.
          # We tentatively set the threshold to 20 to observe in production and adjust.
          long_message_queue_enable_threshold: [type: :integer, default: 20],
          long_message_queue_disable_threshold: [type: :integer, default: 0]
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
            ]}}
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
        ],
        default: []
      ]
    ]
  end
end
