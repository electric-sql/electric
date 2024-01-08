Port for HTTP connections.

This exposes an HTTP API used by the [CLI and Generator](./cli.md) on `/api` and a WebSocket API used by the [Satellite replication protocol](./satellite.md) on `/ws`.

When using the [Proxy tunnel](./cli.md#proxy-tunnel), connections to the [Migrations proxy](#migrations-proxy) are also tunneled over this port.