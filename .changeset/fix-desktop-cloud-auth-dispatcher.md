---
"@electric-ax/agents": patch
---

Preserve existing undici global dispatcher interceptors when installing the Durable Streams fetch cache so Electric Agents Desktop keeps injecting Cloud auth headers after the built-in agents runtime starts.
