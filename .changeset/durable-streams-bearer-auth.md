---
"@electric-ax/agents-server": minor
---

Add tenant-scoped Durable Streams bearer auth for agents-server library hosts.

Tenant runtimes and request contexts can now provide a static bearer token or a
zero-argument token provider for downstream Durable Streams requests.
