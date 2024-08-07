# Telemetry

Electric provides telemetry data — such as traces, logs, and metrics — for real-time system monitoring. 

## Metrics
Metrics are reported in StatsD and Prometheus formats. To configure Electric to expose metric information in those formats use the following environment variables.

| VARIABLE| Description     |
|---------------|------------|
| STATSD_HOST | The address of the StatsD server |
| PROMETHEUS_PORT | The scrape port for Prometheus |

You can get the current status of the service by calling the `http://electric-hostname:PROMETHUES_PORT/metrics` endpoint.

## OpenTelemetry
Metrics, traces and logs are exported using the OpenTelemetry Protocol (OTLP). You can configure the OpenTelemetry Exporter for Electric using the following environment variables.

| VARIABLE| Description     |
|---------------|------------|
| OTEL_EXPORT | `debug` outputs telemetry data to stdout |
| | `otlp` sends the telemetry data to an OTLP endpoint  |
| OTLP_ENDPOINT | The exporter endpoint url |

Electric always adds the following resource attributes to events:
```elixir
%{service: %{name: service_name, version: version}, instance: %{id: instance_id}}
```

Attributes `service_name` and `instance_id` can be overriden with `ELECTRIC_SERVICE_NAME` and `ELECTRIC_INSTANCE_ID` respectively. By default, `instance_id` is an uuid.

Electric will also load additional resource attributes from `OTEL_RESOURCE_ATTRIBUTES`. Learn more about resource attributes in [OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/resources/).

## Example
You can find an example of a docker compose that runs Electric with an OpenTelemetry Collector agent that sends telemetry data to Honeycomb under `packages/sync-service/dev`. Set `HNY_DATASET` and `HNY_API_KEY` with your Honeycomb information and start the compose file like: ```docker compose -f docker-compose-otel.yml up```

