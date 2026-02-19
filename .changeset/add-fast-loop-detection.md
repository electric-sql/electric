---
'@electric-sql/client': patch
---

Add fast-loop detection with automatic cache recovery to ShapeStream. When the client detects rapid requests stuck at the same offset (indicating stale client-side caches or proxy/CDN misconfiguration), it clears the affected shape's cached state and resets the stream to fetch from scratch. If the loop persists, exponential backoff is applied before eventually throwing a diagnostic error.
