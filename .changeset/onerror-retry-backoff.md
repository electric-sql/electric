---
"@electric-sql/client": patch
---

Add exponential backoff with jitter to `ShapeStream` retries requested by `onError`, preventing tight retry loops for persistent non-429 4xx errors while keeping the consecutive retry guard as a final safety net.
