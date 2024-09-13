# @electric-sql/client

## 0.4.1

### Patch Changes

- e3a07b7: Return 400 if shape ID does not match shape definition. Also handle 400 status codes on the client.
- 412ea8e: Fix bug that occured when parsing column named "value" with a null value.

## 0.4.0

### Minor Changes

- fe251c8: Expose a `lastSyncedAt` field on the `ShapeStream` and `Shape` classes which is the time elapsed since the last sync with Electric (in milliseconds). Remove the `isUpToDate` field on the `Shape` class.

### Patch Changes

- fe251c8: Expose an `isConnected` method on `ShapeStream` and `Shape` classes.

## 0.3.4

### Patch Changes

- 42a51c3: Allow specifying data type through type templating in `ShapeStream` and `Shape` APIs.

## 0.3.3

### Patch Changes

- d3b4711: Fix nullable array fields not being parsed as `null`.

## 0.3.2

### Patch Changes

- a6c7bed: Add `Message` type guard helpers `isChangeMessage` and `isControlMessage`.

## 0.3.1

### Patch Changes

- 09f8636: Include nullability information in schema. Also parse null values in the JS client.

## 0.3.0

### Minor Changes

- 8e584a1: Fix: rename "action" header -> "operation" to match Postgres's name for inserts, updates, deletes

## 0.2.2

### Patch Changes

- 06e843c: Only include schema in header of responses to non-live requests.
- 22f388f: Parse float4 into a JS Number in the JS ShapeStream abstraction.

## 0.2.1

### Patch Changes

- 5c43a31: Parse values of basic types (int2, int4, int8, float8, bool, json/jsonb) and arrays of those types into JS values on the client.

## 0.2.0

### Minor Changes

- 1ca40a7: feat: refactor ShapeStream API to combine and to better support API proxies

## 0.1.1

### Patch Changes

- c3aafda: fix: add prepack script so typescript gets compiled before publishing

## 0.1.0

### Minor Changes

- 36b9ab5: Update the client to work correctly with patch (instead of full) updates

## 0.0.8

### Patch Changes

- fedf95c: fix: make packaging work in Remix, etc.

## 0.0.7

### Patch Changes

- 4ce7634: useShape now uses useSyncExternalStoreWithSelector for better integration with React's rendering lifecycle

## 0.0.6

### Patch Changes

- 324effc: Updated typescript-client README and docs page.

## 0.0.5

### Patch Changes

- 7208887: Fix `fetch` not being bound correctly

## 0.0.4

### Patch Changes

- 958cc0c: Respect 409 errors by restarting the stream with the new `shape_id`.

## 0.0.3

### Patch Changes

- af3452a: Fix empty initial requests leading to infinite loop of empty live requests.
- cf3b3bb: Updated package author, license and homepage.
- 6fdb1b2: chore: updated testing fixtures

## 0.0.2

### Patch Changes

- 3656959: Fixed publishing to include built code
