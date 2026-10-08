---
"@core/sync-service": patch
---

Store the non-indexable shapes of a shape-filter node as one ETS row per shape instead of a single map that was copied in and out of ETS on every insert and delete. Adding or removing a shape whose where clause cannot be indexed (or adding an indexed shape to a node that holds such shapes) was O(n) in the number of non-indexed shapes already on the node, so creating many such shapes — and re-adding them all on startup — cost O(n²). It is now O(1) per shape.
