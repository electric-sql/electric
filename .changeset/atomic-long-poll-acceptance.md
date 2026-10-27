---
'@electric-sql/client': patch
---

Keep the last accepted offset, handle, cursor, and schema when a long-poll response body cannot be parsed or is not an array. Retries requested by `onError` bypass cached invalid responses and discard speculative chunks without skipping data. Existing error types and caller retry policy are preserved.
