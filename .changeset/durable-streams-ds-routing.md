---
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
---

Route Durable Streams subscription control traffic through the reserved `__ds` prefix under each stream URL. Agents-server now accepts control routes at the server-root `__ds` prefix, proxies them before normal stream operations, and forwards Durable Streams requests through the resolved tenant stream root instead of inferring cloud-specific URL shapes.
