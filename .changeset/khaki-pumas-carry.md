---
"@core/sync-service": patch
---

fix: correctly catch race conditions when the shape has been validated against old schema, but the underlying schema changed before we got to a snapshot query or publicaiton alteration
