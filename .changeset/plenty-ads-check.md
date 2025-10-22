---
'@core/sync-service': patch
---

Keep track of process inboxes when they exceed the "long message queue" threshold. Adjust all system threshold to be more in line with the expected runtime characteristics of the VM in prod.
