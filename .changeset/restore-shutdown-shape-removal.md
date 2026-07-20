---
'@core/sync-service': patch
---

Stop subquery shapes from being spuriously removed during a server restart. When
a dependency consumer's inline call to its materializer raced the materializer's
shutdown, the resulting `:noproc` exit crashed the consumer and removed the shape
from disk, causing a `409 must-refetch` after the restart. The consumer now
absorbs that exit and lets the monitored `:DOWN` drive a clean stop.
