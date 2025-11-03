---
'@electric-sql/client': patch
---

Fix duplicate operations being emitted after error recovery with `onError` handler. When the `onError` handler returned new params/headers to retry after an error (e.g., 401), the stream was resetting its offset and refetching all data from the beginning, causing duplicate insert operations and "already exists" errors in collections. The stream now correctly preserves its offset during error recovery and continues from where it left off.
