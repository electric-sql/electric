---
'@electric-sql/client': patch
---

Fix prefetch buffer incorrectly serving cached GET responses to POST subset/snapshot requests that share the same URL, which could route stream chunks into the subset handler.
