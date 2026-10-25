---
"@core/sync-service": patch
---

Keep a live SSE response streaming after the shape log passes a chunk boundary. Each segment's chunk end was worked out from the request's original offset, so once the log grew past that chunk the response sent nothing more, not even an up-to-date, until the SSE timeout closed it. Segments now start from where the previous one ended, and a segment that stops at a chunk boundary is followed at once by the rest of the log.
