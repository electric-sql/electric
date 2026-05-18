---
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
---

Route Durable Streams subscription control traffic through the reserved `__ds` prefix under each stream URL. Agents-server now accepts control routes at the server-root `__ds` prefix, proxies them before normal stream operations, supports tenant-root cloud stream URLs, and keeps tenant-relative stream names for `/v1/streams/:service` roots.
