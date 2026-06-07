---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
---

Fix runtime-originated agent send attribution by sending `from_principal`, `from_agent`, and the active wake write token, and accepting `from_agent` when backed by a valid agent write token.
