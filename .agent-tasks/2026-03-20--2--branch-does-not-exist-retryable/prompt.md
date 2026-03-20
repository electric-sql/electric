# Task Prompt

Assigned issue #2 from electric-sql/alco-agent-tasks.

**Issue title:** Reclassify the branch_does_not_exist error to be retryable

**Issue body:** See https://github.com/electric-sql/stratovolt/issues/1185 for background. Reclassify the `branch_does_not_exist` error to be retryable since it's a terrible experience for the customer to have their source stop until a manual restart due to a routine cluster upgrade event. The change must be made in https://github.com/electric-sql/electric.

**Background from stratovolt#1185:** PlanetScale Postgres sources experience a transient "branch does not exist" error during cluster maintenance windows. This error is classified as `config_error` (non-retryable via `retry_may_fix?: false`), which causes the source to be permanently shut down instead of retrying and recovering. The error resolves on its own within seconds after cluster maintenance completes.
