# @core/elixir-client

## 0.2.6-beta.0

### Patch Changes

- 1b8dce0: Fix race condition where response comes before listener has monitored itself.
- 71b8ab2: Add pool behaviour for the Elixir client to allow for per-client persistent connections. Add request timestamp and shape handle to replication stream messages.
- fc1796a: Fix stalled elixir client streams by ensuring that requests are always made, even if calling process dies
- 01c63ae: Fix race condition in elixir client when multiple simultaneous clients are streaming the same shape
- 9f0b96a: Add generic params to client config that are appended to every request, remove database_id top-level config as it can be done via the params.

## 0.2.5

### Patch Changes

- 6d9b73b: fix: make sure the client is not stuck when the request dies for some reason

## 0.2.4

### Patch Changes

- ea5d03f: Fix mishandling of 400s - should terminate
- af0c0bf: Always use sorted query parameters in official clients to ensure Shape URLs are cached consistently.

## 0.2.3

### Patch Changes

- 090fab5: Fix source links in Hexdocs
- fed0761: feat: accept URI structs as endpoint/base_url options
- 9718ccc: feat: allow http1 protocotol on Electric client by default
- 5b25505: Derive Jason.Encoder for Client.ShapeDefinition

## 0.2.2

### Patch Changes

- 6353810: Fixed versioning in CI

## 0.2.1

### Patch Changes

- 4245ec9: Add :endpoint configuration for Elixir client for non-standard API URLs
- 8b6621f: Add database id to elixir client to support multi-tenancy and replace old `update_mode` parameter with `replica`

## 0.2.0

### Minor Changes

- a196399: Add Elixir client implementation

### Patch Changes

- 3ff3def: Allow for outputting columns as list in shape parameters
