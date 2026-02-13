---
'@core/sync-service': patch
---

Improve 503 error response when concurrent request limit is exceeded. Change error code from generic `"overloaded"` to `"concurrent_request_limit_exceeded"` and include the request kind and configured limit in the message.
