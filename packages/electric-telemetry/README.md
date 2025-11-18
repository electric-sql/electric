# ElectricTelemetry

Library used by Electric to gather telemetry and export it to a number of supported destinations. Originally extracted from [electric-sql/electric](https://github.com/electric-sql/electric).

## Installation

Install it by adding `electric_telemetry` to your list of dependencies in `mix.exs`:

```elixir
def deps do
  [
    {:electric_telemetry, github: "electric-sql/electric", sparse: "packages/electric-telemetry"}
  ]
end
```

## Configuration

Runtime configuration can partially be done via app env

```elixir
config :electric_telemetry,
  otel_opts: [
    otlp_endpoint: "...",
    otlp_headers: %{...}
    resource: %{...}
  ]
```

but the majority of the supported configuration options are passed as keyword list to either `ElectricTelemetry.ApplicationTelemetry` or `ElectricTelemetry.StackTelemetry`. See `ElectricTelemetry.Opts` for the supported options.

## Overview

At a high level, the library includes these modules:

- `ElectricTelemetry` includes basic utilities such as validating user options.

- `ElectricTelemetry.ApplicationTelemetry` defines metrics and periodic measurements that apply to BEAM as a whole.

- `ElectricTelemetry.StackTelemetry` defines metrics that are specific to the notion of an
  Electric stack: shape stats, replication client stats, etc. No builtin measurements are defines here.

- Reporter modules. These are enabled individually and are used for exporting metrics to the corresponding destination.
