---
'@core/sync-service': patch
---

fix: ensure correct log reading near the log start, especially when a move-in/out is a first thing in the shape log
fix: ensure correct processing of move-in/move-out sequences affecting same values
fix: ensure correct move-in handling without duplicated data
