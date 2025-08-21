---
"@electric-sql/client": patch
"@core/elixir-client": patch
"@core/sync-service": patch
---

Ensure 409s do not lead to infinite request cycles because of caching.
