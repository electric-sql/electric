---
outline: deep
---

# Telemetry

Electric provides telemetry data — such as traces, logs, and metrics — for real-time system monitoring. 

## Metrics

Metrics are reported in StatsD and Prometheus formats. To configure Electric to expose metric information in those formats use the following environment variables.

| VARIABLE        | Description |
|-----------------|-------------|
| STATSD_HOST     | The address of the StatsD server |
| PROMETHEUS_PORT | The scrape port for Prometheus |

You can get the current status of the service by calling the `http://electric-hostname:PROMETHUES_PORT/metrics` endpoint.

## OpenTelemetry

Metrics, traces and logs are exported using the OpenTelemetry Protocol (OTLP). You can configure the OpenTelemetry Exporter for Electric using the following environment variables.

| VARIABLE      | Type      | Description     |
|---------------|-----------|-----------------|
| OTLP_ENDPOINT | `URL`     | An OpenTelemetry collector endpoint url. |
| HNY_API_KEY   | `string`  | API key for exporting to Honeycomb.io. |
| HNY_DATASET   | `string`  | Dataset name for Honeycomb.io. |
| OTEL_DEBUG    | `boolean` | Enable or disable debug logging of telemetry data to stdout. |

Electric enables export of telemetry data when it is configured with an `OTLP_ENDPOINT`.

There is builtin support for [Honeycomb.io](https://www.honeycomb.io/): telemetry data can be exported directly to it by specifying `OTLP_ENDPOINT=https://api.honeycomb.io` and adding at least the `HNY_API_KEY` configuration option.

In order to use other telemetry data collectors, you'll need to run the [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) and include the exporter of choice in its configuration file along with any required credentials, then use Collector's URL as the value for `OTLP_ENDPOINT`.

Electric always adds the following resource attributes to events:

```elixir
%{service: %{name: service_name, version: version}, instance: %{id: instance_id}}
```

Attributes `service_name` and `instance_id` can be overridden with `ELECTRIC_SERVICE_NAME` and `ELECTRIC_INSTANCE_ID` respectively. By default, `instance_id` is an uuid.

Electric will also load additional resource attributes from `OTEL_RESOURCE_ATTRIBUTES`. Learn more about resource attributes in the [OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/resources/).

## Example

You can find an example of a docker compose that runs Electric with an OpenTelemetry Collector agent that sends telemetry data to Honeycomb under `packages/sync-service/dev`.

Set `HNY_DATASET` and `HNY_API_KEY` environment variables in a terminal session and run docker compose in it like so:

```shell
docker compose -f docker-compose-otel.yml up
```
