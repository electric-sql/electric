---
"@core/sync-service": patch
---

Fix error that occurs when a `/shape` response stream is closed before it is complete,
for example when `curl --head` is used to call the endpoint.
