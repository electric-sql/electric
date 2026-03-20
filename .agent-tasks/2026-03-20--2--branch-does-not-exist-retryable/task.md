# Task Description

Change the `branch_does_not_exist` error classification in `DbConnectionError` from non-retryable (`retry_may_fix?: false`) to retryable (`retry_may_fix?: true`).

## Location

`packages/sync-service/lib/electric/db_connection_error.ex`, line 215.

## Rationale

PlanetScale returns this error transiently during cluster maintenance. The error resolves within seconds. Classifying it as non-retryable causes sources to be permanently shut down, requiring manual restart.

## Changes Required

1. Change `retry_may_fix?: false` to `retry_may_fix?: true` in the `branch_does_not_exist` clause
2. Update corresponding test assertion
3. Create a changeset entry
