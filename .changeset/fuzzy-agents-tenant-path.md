---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
"@electric-ax/agents": patch
"electric-ax": patch
---

Treat Electric Agents server URLs as tenant-scoped base URLs rooted at `/t/<service-id>/v1`, and canonicalize legacy service query routing into that path when appending client API paths.
