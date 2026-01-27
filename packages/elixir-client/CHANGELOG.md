# @core/elixir-client

## 0.8.3

### Patch Changes

- 571ed07: Update electric dependency to allow for v1.3.3

## 0.8.2

### Patch Changes

- 8fa682c: Skip hex.pm publish when version already exists to avoid unnecessary CI builds

## 0.8.1

### Patch Changes

- 5a767e6: Add Move-Out Support for Subqueries in Elixir Client

## 0.8.0

### Minor Changes

- b94f236: Update electric dependency to support 1.2

## 0.7.3

### Patch Changes

- e07f39b: Add support for new snapshot-end control to elixir client

## 0.7.2

### Patch Changes

- bb37ebb: Fix representation in query of parameterized types backed by uuid column
- d0100fe: Ensure that UUID fields are passed to parameterized types' load function in the expected binary form
- 7a48fc1: Pass through column values not in schema rather than dropping them, which is consistent with the behaviour of the typescript implementation

## 0.7.1

### Patch Changes

- 2c19914: Ensure 409s do not lead to infinite request cycles because of caching.

## 0.7.0

### Minor Changes

- 2284ffd: Include txid information in message headers and bump electric requirement to ~> 1.1.1

## 0.6.5

### Patch Changes

- 421315f: Fix handling of Ecto embeds when deserializing
- 828f6dc: Translate error responses from Api.validate/2 to the expected form in the embedded client
- 8e95270: Fix decoding of must-refetch messages
- 8cc06b5: Support specifying column subsets via Ecto.Query.select/3

## 0.6.4

### Patch Changes

- 0baa791: Bump the minimum required version of Electric to v1.0.6.

## 0.6.3

### Patch Changes

- 6ed4a27: Fix mapping of Ecto.ULID columns
- 6ed4a27: Add support for casting array and map fields to the Ecto.Adapter

## 0.6.2

### Patch Changes

- 3f43346: Support generating shape definitions from Ecto.Changeset structs, add replica mode to client ShapeDefinitions, ensure client parameters are always of type %{binary() => binary()} and expose some options schema information for use in Phoenix.Sync

## 0.6.1

### Patch Changes

- 67b8172: Add support for array parameters in ecto where clauses

## 0.6.0

### Minor Changes

- 000f96d: Enabling correct handling and dumping of custom types in fields

### Patch Changes

- 0928065: Allow for using a custom Finch pool in the Elixir client
- b327626: Fix consumption of embedded API across processes

## 0.5.0

### Minor Changes

- bdb031e: Allow server errors to be streamed to the consumer rather than raising

## 0.4.1

### Patch Changes

- 99172f4: Update Electric dependency

## 0.4.0

### Minor Changes

- 63b9b9f: Include old value in Elixir client update messages

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
