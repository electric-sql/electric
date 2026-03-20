# Discarded Threads

## Conditional retryability based on preceding errors

The stratovolt issue suggested an alternative: "treat it as retryable when it follows a `database_server_unavailable` error." This was considered but discarded because:

1. The simple reclassification achieves the same outcome with less complexity
2. Electric Cloud's timeout mechanism already handles the case where the error is genuinely permanent (source will be shut down after repeated failures within a time window)
3. There is no downside to retrying a few times even if the branch truly doesn't exist — the timeout mechanism catches it
