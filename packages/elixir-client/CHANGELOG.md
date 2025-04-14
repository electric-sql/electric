# @core/elixir-client

## 0.3.2

### Patch Changes

- a466a6e: Add prefix support to the Elixir client

## 0.3.1

### Patch Changes

- 9cd556c: Change retry behaviour to timeout after some number of seconds, or keep going indefinitely

## 0.3.0

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

### Patch Changes

- 1b8dce0: Fix race condition where response comes before listener has monitored itself.
- 27481c9: Remove requirement for a shape definition from Electric.Client.stream, so we now support endpoints that return a pre-configured stream. Also remove `oneshot` configuration flag as it no longer makes sense
- 0dd1f0c: feat: add support for parameters in where clauses to clients
- 71b8ab2: Add pool behaviour for the Elixir client to allow for per-client persistent connections. Add request timestamp and shape handle to replication stream messages.
- fc1796a: Fix stalled elixir client streams by ensuring that requests are always made, even if calling process dies
- 01c63ae: Fix race condition in elixir client when multiple simultaneous clients are streaming the same shape
- df1c18f: Fix race condition when using mock backend
- 8ce1353: Add embedded mode to Elixir client using the new Shapes API
- 9554498: Improve public APIs of Elixir client and core electric
- 9f0b96a: Add generic params to client config that are appended to every request, remove database_id top-level config as it can be done via the params.

## 0.3.0-beta.4

### Patch Changes

- 27481c9: Remove requirement for a shape definition from Electric.Client.stream, so we now support endpoints that return a pre-configured stream. Also remove `oneshot` configuration flag as it no longer makes sense
- 9554498: Improve public APIs of Elixir client and core electric

## 0.3.0-beta.3

### Patch Changes

- 8ce1353: Add embedded mode to Elixir client using the new Shapes API

## 0.3.0-beta.2

### Minor Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

## 0.2.6-beta.1

### Patch Changes

- df1c18f: Fix race condition when using mock backend

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
