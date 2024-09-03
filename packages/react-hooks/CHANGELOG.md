# @electric-sql/react

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
