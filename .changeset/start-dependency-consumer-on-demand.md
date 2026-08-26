---
'@core/sync-service': patch
---

Start the consumer of a dependency shape on demand when its materializer starts. A dependency shape can be registered with a completed snapshot but no running consumer (for example when restored on restart after its parent was removed, since consumers only start lazily on transaction routing). Requests for a parent shape then failed repeatedly: the dependency materializer crashed calling the missing consumer, the parent was invalidated, and the still-registered dependency poisoned every retry.
