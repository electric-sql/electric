---
"@electric-sql/client": patch
---

Fix duplicate download of subset snapshot responses caused by the chunk prefetcher mistaking them for a normal chunk to prefetch.
