---
'@electric-sql/client': patch
---

Fix unbounded URL growth on 409 retries when a proxy strips the handle header. Instead of appending `-next` to the handle (which grew indefinitely), the client now uses a random `cache-buster` query param to ensure unique retry URLs. Also warns when this fallback fires.
