---
"electric-sql": patch
---

Fixed `liveMany`, `liveUnique`, and `liveFirst` functions not exposing the `include` tables properly, making `useLiveQuery` miss some relevant updates
