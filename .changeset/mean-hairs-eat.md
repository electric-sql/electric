---
'@core/elixir-client': patch
---

Switch retry backoff to full jitter strategy, matching the TypeScript client
and providing better spread to avoid thundering herd.
