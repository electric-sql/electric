defmodule Electric.Telemetry.OpenTelemetry.Config do
  import Config

  @doc """
  Configure opentelemetry_exporter and opentelemetry apps.

  This function is supposed to be called from config/runtime.exs.
  """
  def configure(opts) do
    otlp_endpoint = Keyword.fetch!(opts, :otlp_endpoint)
    otlp_headers = Keyword.fetch!(opts, :otlp_headers)
    otel_resource = Keyword.fetch!(opts, :otel_resource)
    otel_debug? = Keyword.fetch!(opts, :otel_debug?)

    config :opentelemetry_exporter,
      otlp_protocol: :http_protobuf,
      otlp_endpoint: otlp_endpoint,
      otlp_headers: otlp_headers,
      otlp_compression: :gzip

    otel_batch_processor =
      if otlp_endpoint do
        {:otel_batch_processor, %{}}
      end

    otel_simple_processor =
      if otel_debug? do
        # In this mode, each span is printed to stdout as soon as it ends, without batching.
        {:otel_simple_processor, %{exporter: {:otel_exporter_stdout, []}}}
      end

    config :opentelemetry,
      resource_detectors: [
        :otel_resource_env_var,
        :otel_resource_app_env,
        Electric.Telemetry.OpenTelemetry.ResourceDetector
      ],
      resource: otel_resource,
      processors: [otel_batch_processor, otel_simple_processor] |> Enum.reject(&is_nil/1)
  end
end
