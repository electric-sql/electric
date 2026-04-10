---
'@electric-sql/client': patch
---

Bound the `onError` retry loop to prevent unbounded retries and memory growth. When `onError` always returns a retry directive for a persistent error (e.g. a 400 from a misconfigured proxy), the client now limits consecutive retries to 50 before tearing down the stream and notifying subscribers. The counter resets on successful data (non-empty message batch or 204 No Content), so intermittent errors that recover do not accumulate toward the limit.
