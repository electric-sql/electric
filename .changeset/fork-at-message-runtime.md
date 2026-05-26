---
'@electric-ax/agents-runtime': patch
---

Add `EventPointer { offset, subOffset }` for addressing single events on a durable stream. Widen `__electricRowOffsets` side-tables on `EntityStreamDB` collections from `Map<key, string>` to `Map<key, EventPointer>`, with pointers minted along log-entry boundaries (grouped by each item's `headers.offset`) so they round-trip cleanly through `Stream-Fork-Sub-Offset` regardless of how a live read is chunked.
