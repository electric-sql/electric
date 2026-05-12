---
'@electric-ax/agents-server': patch
'@electric-ax/agents-runtime': patch
'@electric-ax/agents': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-desktop': patch
---

Add principals support to the agents system. Every API request now carries a `Principal` (user, agent, service, or system) threaded through the full request lifecycle. Runner dispatch is scoped to the authenticated owner via dispatch policy authorization. The runtime exposes `ctx.principal` in handler context so agent code can implement principal-aware logic. The server UI uses asserted identity headers for dev-mode authentication.
