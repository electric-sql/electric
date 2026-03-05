---
'@electric-sql/client': patch
---

Fix unbounded `-next` suffix accumulation on shape handle during repeated 409 retries. When a proxy strips the handle header from 409 responses, the client now correctly caps the fallback handle at a single `-next` suffix instead of appending indefinitely. Also adds a console warning when this fallback path is triggered.
