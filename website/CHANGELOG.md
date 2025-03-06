# @electric-sql/docs

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
    url: "http://localhost:3000/v1/shape",
    params: {
      table: "items",
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
