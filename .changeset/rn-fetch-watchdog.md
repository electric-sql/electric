---
"@electric-sql/client": patch
---

Add a request watchdog so ShapeStream can recover when mobile fetch implementations hang across app lifecycle or network transitions. Live long-poll requests and refresh catch-up requests now time out after `liveRequestTimeoutMs` (default 45s, or `false` to disable), abort with an internal `live-request-timeout` reason, and restart the request loop even if the platform fetch promise never settles.

Also make retry backoff abort-aware at sleep entry, keep wake-triggered refreshes in non-live catch-up mode until the next request-loop tick completes, and auto-detect React Native AppState when available so mobile apps pause Electric requests while backgrounded and resume catch-up after foregrounding. A runtime visibility adapter hook remains available for other non-browser runtimes.
