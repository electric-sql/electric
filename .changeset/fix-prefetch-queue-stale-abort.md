---
'@electric-sql/client': patch
---

Fix stream stopping after tab visibility changes due to stale aborted requests in PrefetchQueue.

**Root cause:** When a page is hidden, the stream pauses and aborts in-flight prefetch requests. The aborted promises remained in the PrefetchQueue's internal Map. When the page became visible and the stream resumed, `consume()` returned the stale aborted promise, causing an AbortError to propagate to ShapeStream and stop syncing.

**The fix:**
- `PrefetchQueue.consume()` now checks if the request's abort signal is already aborted before returning it
- `PrefetchQueue.abort()` now clears the internal map after aborting controllers
- The fetch wrapper clears `prefetchQueue` after calling `abort()` to ensure fresh requests

Fixes #3460
