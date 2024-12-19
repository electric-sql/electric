# @electric-sql/docs

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
