# Electric.Telemetry

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

Telemetry must be enabled at compile time by placing the following line in your app's `config/config.exs` file:

```elixir
config :electric_telemetry, enabled?: true
```

Runtime configuration can partially be done via app env

```elixir
config :electric_telemetry,
  otel_opts: [
    otlp_endpoint: "...",
    otlp_headers: %{...}
    resource: %{...}
  ]
```

but the majority of the supported configuration options are passed as keyword list to either `Electric.Telemetry.ApplicationTelemetry` or `Electric.Telemetry.StackTelemetry`. See `Electric.Telemetry.Opts` for the supported options.

## Overview

At a high level, the library includes these modules:

  - `Electric.Telemetry` as the top-level interface for determining whether telemetry
  collection and/or export is enabled. Defines macros that are used to conditionally compile
  other collecting and exporting modules.

  - `Electric.Telemetry.ApplicationTelemetry` defines metrics and periodic measurements that apply to BEAM as a whole.

  - `Electric.Telemetry.StackTelemetry` defines metrics that are specific to the notion of an
  Electric stack: shape stats, replication client stats, etc. No builtin measurements are defines here.

  - Reporter modules. These are enabled individually and are used for exporting metrics to the corresponding destination.
