---
"@core/electric": patch
---

Limit the number of changes in a websocket frame to 100 changes to reduce the chance of frame exceeding 100MB limit in the case where there are lots of changes
