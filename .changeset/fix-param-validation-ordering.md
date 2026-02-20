---
'@core/sync-service': patch
---

Fix parameter validation rejecting valid sequential params when there are 10 or more of them, due to map keys being iterated in lexicographic rather than numeric order.
