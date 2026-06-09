---
"@core/sync-service": patch
---

Speed up relation change routing by collecting shape ids directly from the filter's shape table instead of walking where-condition indexes.
