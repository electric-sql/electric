---
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
---

Prepare the agents server and server conformance test packages for public npm publication.

The agents server package now publishes its Drizzle migration files alongside the built entrypoints so installed servers can run database migrations outside the monorepo.
