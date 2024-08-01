---
"@core/sync-service": patch
---

Reduce memory footprint of initial sync by streaming data from storage, for example a 35MB / 200k row table did require 550MB but now requires 50MB
