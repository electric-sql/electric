---
'@electric-sql/client': patch
---

Fix stale CDN response incorrectly updating client offset. When a CDN returns a cached response with an expired shape handle, the client now ignores the entire response (including offset) to prevent handle/offset mismatch that would cause server errors.
