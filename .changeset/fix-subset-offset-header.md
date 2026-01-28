---
'@core/sync-service': patch
---

Fix missing `electric-offset` header in subset snapshot responses. This header was not being set for subset responses, causing POST subset requests to fail with `MissingHeadersError` in the TypeScript client.
