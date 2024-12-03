---
title: Telemetry
description: >-
  Electric provides telemetry data for real-time system monitoring.
outline: deep
---

# Telemetry

Electric provides telemetry data — such as traces, logs, and metrics — for real-time system monitoring. Self-hosted Electric instances are also configured by default to send aggregated, anonymous usage data to ElectricSQL to help us understand how our software is being used. You can opt-out of this reporting by setting an environment variable. See the [Anonymous usage data](#anonymous-usage-data) section below for more details.

## Metrics

Metrics are reported in StatsD and Prometheus formats. To configure Electric to expose metric information in those formats use the following environment variables.

| VARIABLE        | Description |
|-----------------|-------------|
| ELECTRIC_STATSD_HOST     | The address of the StatsD server |
| ELECTRIC_PROMETHEUS_PORT | The scrape port for Prometheus |

You can get the current status of the service by calling the `http://electric-hostname:PROMETHUES_PORT/metrics` endpoint.

## OpenTelemetry

Traces are exported using the OpenTelemetry Protocol (OTLP). You can configure the OpenTelemetry Exporter for Electric using the following environment variables.

| VARIABLE      | Type      | Description     |
|---------------|-----------|-----------------|
| ELECTRIC_OTLP_ENDPOINT | `URL`     | An OpenTelemetry collector endpoint url. |
| ELECTRIC_HNY_API_KEY   | `string`  | API key for exporting to Honeycomb.io. |
| ELECTRIC_HNY_DATASET   | `string`  | Dataset name for Honeycomb.io. |
| ELECTRIC_OTEL_DEBUG    | `boolean` | Enable or disable debug logging of telemetry data to stdout. |

Electric enables export of telemetry data when it is configured with an `ELECTRIC_OTLP_ENDPOINT`.

There is builtin support for [Honeycomb.io](https://www.honeycomb.io/): telemetry data can be exported directly to it by specifying `ELECTRIC_OTLP_ENDPOINT=https://api.honeycomb.io` and adding at least the `ELECTRIC_HNY_API_KEY` configuration option.

In order to use other telemetry data collectors, you'll need to run the [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/) and include the exporter of choice in its configuration file along with any required credentials, then use Collector's URL as the value for `ELECTRIC_OTLP_ENDPOINT`.

Electric always adds the following resource attributes to events:

```elixir
%{service: %{name: service_name, version: version}, instance: %{id: instance_id}}
```

Attributes `service_name` and `instance_id` can be overridden with `ELECTRIC_SERVICE_NAME` and `ELECTRIC_INSTANCE_ID` respectively. By default, `instance_id` is an uuid.

Electric will also load additional resource attributes from `OTEL_RESOURCE_ATTRIBUTES`. Learn more about resource attributes in the [OpenTelemetry documentation](https://opentelemetry.io/docs/languages/js/resources/).

## Example

You can find an example of a docker compose that runs Electric with an OpenTelemetry Collector agent that sends telemetry data to Honeycomb under `packages/sync-service/dev`.

Set `ELECTRIC_HNY_DATASET` and `ELECTRIC_HNY_API_KEY` environment variables in a terminal session and run docker compose in it like so:

```shell
docker compose -f docker-compose-otel.yml up
```

## Anonymous usage data

Electric instances are configured by default to send anonymized usage data to checkpoint.electric-sql.com to help us understand how the software is being used. Absolutely no information about transaction contents is sent. I.e.: none of your data that you're using Electric to replicate is captured in the telemetry information or shared with the Electric checkpoint service. Captured data includes the disk usage by the shape cache, CPU/memory information about the running Electric instance, Postgres version, number of shapes, amount of distinct shape requests, and numerical information about processed transactions: byte size, amount of operations, and percentiles of response times. Essentially, what kind of load Electric was under, and how did it cope.

Aggregated statistics are sent every 30 minutes.

To disable anonymous usage data, set the `ELECTRIC_USAGE_REPORTING` environment variable to `false`. We encourage everyone to keep this enabled so we can get a better understanding of how Electric is used. If you have any further questions about what we collect, feel free to ask on our [open community Discord](https://discord.electric-sql.com) or reach out to us via email at [info@electric-sql.com](mailto:info@electric-sql.com).
