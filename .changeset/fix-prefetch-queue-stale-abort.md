---
'@electric-sql/client': patch
---

Fix stream stopping after tab visibility changes due to stale aborted requests in PrefetchQueue.

**Root cause:** When a page is hidden, the stream pauses and aborts in-flight prefetch requests. The aborted promises remained in the PrefetchQueue's internal Map. When the page became visible and the stream resumed with the same URL that was being prefetched, `consume()` returned the stale aborted promise, causing an AbortError to propagate to ShapeStream and stop syncing.

**The fix:** Clear the PrefetchQueue by setting it to `undefined` after calling `abort()`, ensuring subsequent requests make fresh fetches instead of returning stale aborted promises.

**Additional improvements:**
- Add `debug` option to ShapeStream for lifecycle logging (pause/resume, connections, subscriber changes)
- Add stack trace capture when user signal aborts to help diagnose abort sources
- Prevent resume when user's signal is already aborted (e.g., after collection GC)
- Prevent resume when no subscribers remain

Fixes #3460
