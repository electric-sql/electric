---
'@core/elixir-client': patch
---

Add response header validation matching the TypeScript client. Missing Electric
headers now raise a clear error pointing to proxy/CDN misconfiguration instead
of silently producing incorrect behaviour.

