# @electric-sql/react

## 1.0.6

### Patch Changes

- Updated dependencies [7be2fd3]
  - @electric-sql/client@1.0.6

## 1.0.5

### Patch Changes

- Updated dependencies [c59000f]
  - @electric-sql/client@1.0.5

## 1.0.4

### Patch Changes

- Updated dependencies [d12ff0f]
  - @electric-sql/client@1.0.4

## 1.0.3

### Patch Changes

- Updated dependencies [22cde89]
  - @electric-sql/client@1.0.3

## 1.0.2

### Patch Changes

- Updated dependencies [d278b9f]
  - @electric-sql/client@1.0.2

## 1.0.1

### Patch Changes

- Updated dependencies [56c338a]
  - @electric-sql/client@1.0.1

## 1.0.0

### Patch Changes

- 1255205: First beta release
- 19a7ab3: Ensure `useSyncExternalStore` always has latest shape data snapshot.
- 2d9a636: Loosen `react` peer dependency to prevent conflict warnings.
- ade15b9: Expose `stream` in the useShape result data. This allows React components to easily access the stream to match on.
- Updated dependencies [1255205]
- Updated dependencies [ade15b9]
- Updated dependencies [91774d3]
- Updated dependencies [0dd1f0c]
- Updated dependencies [1c28aee]
- Updated dependencies [ade15b9]
- Updated dependencies [19a7ab3]
- Updated dependencies [6616b81]
- Updated dependencies [f1a9247]
- Updated dependencies [dcd8a9f]
- Updated dependencies [dd5aeab]
  - @electric-sql/client@1.0.0

## 1.0.0-beta.6

### Patch Changes

- 19a7ab3: Ensure `useSyncExternalStore` always has latest shape data snapshot.
- Updated dependencies [91774d3]
- Updated dependencies [19a7ab3]
  - @electric-sql/client@1.0.0-beta.5

## 1.0.0-beta.5

### Patch Changes

- Updated dependencies [6616b81]
- Updated dependencies [dcd8a9f]
  - @electric-sql/client@1.0.0-beta.4

## 1.0.0-beta.4

### Patch Changes

- 2d9a636: Loosen `react` peer dependency to prevent conflict warnings.

## 1.0.0-beta.3

### Patch Changes

- Updated dependencies [f1a9247]
  - @electric-sql/client@1.0.0-beta.3

## 1.0.0-beta.2

### Patch Changes

- ade15b9: Expose `stream` in the useShape result data. This allows React components to easily access the stream to match on.
- Updated dependencies [ade15b9]
- Updated dependencies [1c28aee]
- Updated dependencies [ade15b9]
- Updated dependencies [dd5aeab]
  - @electric-sql/client@1.0.0-beta.2

## 1.0.0-beta.1

### Patch Changes

- 1255205: First beta release
- Updated dependencies [1255205]
  - @electric-sql/client@1.0.0-beta.1

## 0.6.2

### Patch Changes

- dae3b0d: Fix node 16 cjs import
- 9886b08: Expose `stream` in the useShape result data. This allows React components to easily access the stream to match on.
- Updated dependencies [9886b08]
- Updated dependencies [dae3b0d]
- Updated dependencies [fbb66e9]
  - @electric-sql/client@0.9.1

## 0.6.1

### Patch Changes

- 67a9347: fix: only clear the React stream/shape cache when the previous stream/shape was aborted

## 0.6.0

### Minor Changes

- e96928e: [BREAKING]: Move non-protocol options like table & where to the params sub-key

  ## Context

  Electric's TypeScript client is currently tightly coupled to PostgreSQL-specific options in its `ShapeStreamOptions` interface. As Electric plans to support multiple data sources in the future, we need to separate protocol-level options from source-specific options.

  ## Changes

  1. Created a new `PostgresParams` type to define PostgreSQL-specific parameters:
     - `table`: The root table for the shape
     - `where`: Where clauses for the shape
     - `columns`: Columns to include in the shape
     - `replica`: Whether to send full or partial row updates
  2. Moved PostgreSQL-specific options from the top-level `ShapeStreamOptions` interface to the `params` sub-key
  3. Updated `ParamsRecord` type to include PostgreSQL parameters
  4. Updated the `ShapeStream` class to handle parameters from the `params` object
  5. Updated documentation to reflect the changes

  ## Migration Example

  Before:

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    table: 'users',
    where: 'id > 100',
    columns: ['id', 'name'],
    replica: 'full',
  })
  ```

  After:

  ```typescript
  const stream = new ShapeStream({
    url: 'http://localhost:3000/v1/shape',
    params: {
      table: 'users',
      where: 'id > 100',
      columns: ['id', 'name'],
      replica: 'full',
    },
  })
  ```

### Patch Changes

- Updated dependencies [9c50e8f]
- Updated dependencies [af0c0bf]
- Updated dependencies [e96928e]
  - @electric-sql/client@0.9.0

## 0.5.4

### Patch Changes

- Updated dependencies [5a7866f]
- Updated dependencies [12fd091]
- Updated dependencies [de204fc]
- Updated dependencies [1faa79b]
- Updated dependencies [c748ec7]
  - @electric-sql/client@0.8.0

## 0.5.3

### Patch Changes

- Updated dependencies [5063314]
- Updated dependencies [71d61b5]
  - @electric-sql/client@0.7.3

## 0.5.2

### Patch Changes

- Updated dependencies [65af31c]
- Updated dependencies [90ead4f]
  - @electric-sql/client@0.7.2

## 0.5.1

### Patch Changes

- Updated dependencies [b367c8d]
  - @electric-sql/client@0.7.1

## 0.5.0

### Minor Changes

- 4d872b6: All `Shape` interfaces (`ShapeStream`, `Shape`, `useShape`) now require `table` as an additional configuration parameter, and the shape API endpoint url only needs to point to `/v1/shape`.

### Patch Changes

- 61a18bd: - Implement `rows` and `currentRows` getters on `Shape` interface for easier data access.
  - [BREAKING] Rename `valueSync` getter on `Shape` to `currentValue` for clarity and consistency.
  - [BREAKING] Change `subscribe` API on `Shape` to accept callbacks with signature `({ rows: T[], value: Map<string, T> }) => void`
- 9bd3673: Clear caches when cached stream is in errored state or is explicitly aborted
- Updated dependencies [61a18bd]
- Updated dependencies [4d872b6]
- Updated dependencies [aed079f]
- Updated dependencies [4d872b6]
  - @electric-sql/client@0.7.0

## 0.4.7

### Patch Changes

- Updated dependencies [7de9f1d]
  - @electric-sql/client@0.6.5

## 0.4.6

### Patch Changes

- Updated dependencies [7f86b47]
  - @electric-sql/client@0.6.4

## 0.4.5

### Patch Changes

- Updated dependencies [25c437f]
  - @electric-sql/client@0.6.3

## 0.4.4

### Patch Changes

- Updated dependencies [c0c9af6]
- Updated dependencies [41845cb]
  - @electric-sql/client@0.6.2

## 0.4.3

### Patch Changes

- Updated dependencies [cfb7955]
- Updated dependencies [c980a76]
  - @electric-sql/client@0.6.1

## 0.4.2

### Patch Changes

- Updated dependencies [b0d258d]
- Updated dependencies [df6cc5b]
- Updated dependencies [e459a62]
  - @electric-sql/client@0.6.0

## 0.4.1

### Patch Changes

- 70da0b5: Expose lastSyncedAt field in ShapeStream and Shape classes and in the useShape React hook.
- Updated dependencies [9992a74]
- Updated dependencies [70da0b5]
  - @electric-sql/client@0.5.1

## 0.4.0

### Minor Changes

- 7765d50: Expose isLoading status in ShapeStream and Shape classes and in useShape React hook.

### Patch Changes

- Updated dependencies [7765d50]
  - @electric-sql/client@0.5.0

## 0.3.6

### Patch Changes

- Updated dependencies [e3a07b7]
- Updated dependencies [412ea8e]
  - @electric-sql/client@0.4.1

## 0.3.5

### Patch Changes

- Updated dependencies [fe251c8]
- Updated dependencies [fe251c8]
  - @electric-sql/client@0.4.0

## 0.3.4

### Patch Changes

- 42a51c3: Allow specifying data type through type templating in all APIs.
- Updated dependencies [42a51c3]
  - @electric-sql/client@0.3.4

## 0.3.3

### Patch Changes

- 3c8f662: Fix `useShape` not returning correct data upon changing `selector` prop - see https://github.com/electric-sql/electric/issues/1446.
- b0f39c7: add test that useShape re-renders on where state change

## 0.3.2

### Patch Changes

- 0836ebb: Improve type of selector argument in useShape hook.
- Updated dependencies [d3b4711]
  - @electric-sql/client@0.3.3

## 0.3.1

### Patch Changes

- 55c8449: Update Readme for removing ShapesProvider

## 0.3.0

### Minor Changes

- 914e768: Remove obsolete ShapesProvider.

### Patch Changes

- Updated dependencies [a6c7bed]
  - @electric-sql/client@0.3.2

## 0.2.1

### Patch Changes

- Updated dependencies [09f8636]
  - @electric-sql/client@0.3.1

## 0.2.0

### Minor Changes

- 8e584a1: Fix: rename "action" header -> "operation" to match Postgres's name for inserts, updates, deletes

### Patch Changes

- Updated dependencies [8e584a1]
  - @electric-sql/client@0.3.0

## 0.1.2

### Patch Changes

- Updated dependencies [06e843c]
- Updated dependencies [22f388f]
  - @electric-sql/client@0.2.2

## 0.1.1

### Patch Changes

- Updated dependencies [5c43a31]
  - @electric-sql/client@0.2.1

## 0.1.0

### Minor Changes

- 1ca40a7: feat: refactor ShapeStream API to combine and to better support API proxies

### Patch Changes

- Updated dependencies [1ca40a7]
  - @electric-sql/client@0.2.0

## 0.0.10

### Patch Changes

- c3aafda: fix: add prepack script so typescript gets compiled before publishing
- Updated dependencies [c3aafda]
  - @electric-sql/client@0.1.1

## 0.0.9

### Patch Changes

- Updated dependencies [36b9ab5]
  - @electric-sql/client@0.1.0

## 0.0.8

### Patch Changes

- fedf95c: fix: make packaging work in Remix, etc.
- Updated dependencies [fedf95c]
  - @electric-sql/client@0.0.8

## 0.0.7

### Patch Changes

- 4ce7634: useShape now uses useSyncExternalStoreWithSelector for better integration with React's rendering lifecycle
- Updated dependencies [4ce7634]
  - @electric-sql/client@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [324effc]
  - @electric-sql/client@0.0.6

## 0.0.5

### Patch Changes

- Updated dependencies [7208887]
  - @electric-sql/client@0.0.5

## 0.0.4

### Patch Changes

- Updated dependencies [958cc0c]
  - @electric-sql/client@0.0.4

## 0.0.3

### Patch Changes

- cf3b3bb: Updated package author, license and homepage.
- 6fdb1b2: chore: updated testing fixtures
- Updated dependencies [af3452a]
- Updated dependencies [cf3b3bb]
- Updated dependencies [6fdb1b2]
  - @electric-sql/client@0.0.3

## 0.0.2

### Patch Changes

- 3656959: Fixed publishing to include built code
- Updated dependencies [3656959]
  - @electric-sql/client@0.0.2
