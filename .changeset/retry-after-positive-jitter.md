---
'@electric-sql/client': patch
---

Add bounded positive jitter (up to 10% of the delay, capped at 5 seconds) when the TypeScript client honors a `Retry-After` header, so clients that receive the same value do not retry at the same instant. The client never retries earlier than the server requested.
