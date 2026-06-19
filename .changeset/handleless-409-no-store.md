---
"@core/sync-service": patch
---

Prevent handle-less `409 must-refetch` responses from being stored by caches, while preserving cacheable redirects for `409` responses that include an `electric-handle`.
