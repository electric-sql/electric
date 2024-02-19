---
"@core/electric": patch
---

Validate public signing keys at startup. This allows for catching invalid key configuration early as opposed to getting an "invalid token signature" error when a client tries to authenticate.
