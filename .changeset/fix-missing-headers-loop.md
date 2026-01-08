---
'@electric-sql/client': patch
---

Fix infinite loop when response is missing required headers

When the server returns 200 OK but with missing required headers (like `electric-cursor`), the client would enter an infinite retry loop if `onError` returned `{}`. Now `MissingHeadersError` is treated as non-retryable since it's a configuration issue that won't self-heal.
