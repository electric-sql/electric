---
"@core/sync-service": patch
---

- Do not await for responses while recovering publication filters.
- Remove publication update debounce time - simply wait until end of current process message queue.

