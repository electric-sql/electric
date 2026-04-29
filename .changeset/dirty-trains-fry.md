---
'@core/elixir-client': patch
---

Sync CDN-resilience fixes from the TypeScript client: cache-buster on every 409, self-heal a stuck expired handle cache and synthetic must-refetch header response for all 409s
