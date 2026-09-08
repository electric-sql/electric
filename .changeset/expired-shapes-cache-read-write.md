---
'@electric-sql/client': patch
---

Stop `ExpiredShapesCache.getExpiredHandle` writing the whole cache to
`localStorage` on every read. The LRU touch it performs runs while building the
URL of every shape request, so in live mode it persisted the entire cache once
per poll for as long as the app stayed open. `lastUsed` is now updated in memory
only; it is read from memory when `markExpired` picks an eviction candidate, so
the sole effect is that eviction order can be staler after a reload.
