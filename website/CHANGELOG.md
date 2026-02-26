# @electric-sql/docs

## 0.0.6

### Patch Changes

- 8691a61: Make gathering of SQLite memory usage metrics optional and default to off to prevent instability in some environments

## 0.0.5

### Patch Changes

- 02cd199: Add exclusive mode with a single read-write sqlite connection to support AWS EFS

## 0.0.4

### Patch Changes

- b0b9445: Remove suspend_consumers feature flag and disable consumer suspend by default

## 0.0.3

### Patch Changes

- 47cda20: Add optional `shardSubdomain` shape option to auto-shard the url subdomain in development. This solves the slow shapes in development problem without needing HTTP/2 or system level deps like Caddy or mkcert.

## 0.0.2

### Patch Changes

- 0dd1f0c: feat: add support for parameters in where clauses to clients
- eb8167a: Implement `ELECTRIC_POOLED_DATABASE_URL` optional env var to perform queries with separate, potentially pooled connection string.
- f6a3265: Fix OpenAPI spec 409 response schema
- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers
- 4d7b8ba: Add support for shapes on partitioned tables
- dd5aeab: This PR adds support for function-based options in the TypeScript client's params and headers. Functions can be either synchronous or asynchronous and are resolved in parallel when needed.

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'items',
      userId: () => getCurrentUserId(),
      filter: async () => await getUserPreferences(),
    },
    headers: {
      Authorization: async () => `Bearer ${await getAccessToken()}`,
    },
  })
  ```

  ## Common Use Cases
  - Authentication tokens that need to be refreshed
  - User-specific parameters that may change
  - Dynamic filtering based on current state
  - Multi-tenant applications where context determines the request

## 0.0.2-beta.3

### Patch Changes

- f6a3265: Fix OpenAPI spec 409 response schema

## 0.0.2-beta.2

### Patch Changes

- f1a9247: feat!: change the wire protocol to remove `offset` and add an explicit `lsn` header. Only valid offset now is the one provided in headers

## 0.0.2-beta.1

### Patch Changes

- 4d7b8ba: Add support for shapes on partitioned tables

## 0.0.2-beta.0

### Patch Changes

- dd5aeab: This PR adds support for function-based options in the TypeScript client's params and headers. Functions can be either synchronous or asynchronous and are resolved in parallel when needed.

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'items',
      userId: () => getCurrentUserId(),
      filter: async () => await getUserPreferences(),
    },
    headers: {
      Authorization: async () => `Bearer ${await getAccessToken()}`,
    },
  })
  ```

  ## Common Use Cases
  - Authentication tokens that need to be refreshed
  - User-specific parameters that may change
  - Dynamic filtering based on current state
  - Multi-tenant applications where context determines the request
