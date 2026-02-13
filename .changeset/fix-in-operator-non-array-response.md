---
'@electric-sql/client': patch
---

Fix `TypeError: Cannot use 'in' operator` crash when a proxy or CDN returns a non-array JSON response from the shape endpoint. Add null-safety to message type guards and throw a proper `FetchError` for non-array responses so the existing retry/backoff infrastructure handles it.
