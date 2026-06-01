---
"@electric-ax/agents": patch
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
"@electric-ax/agents-server-ui": patch
"electric-ax": patch
---

Update Electric Agents packages to depend on the stable Durable Streams
packages instead of pkg.pr builds. This pulls in `@durable-streams/client`
0.2.6, `@durable-streams/server` 0.3.5, and `@durable-streams/state` 0.2.9.
Examples now resolve `@electric-ax/agents-runtime` from the workspace so they
do not keep older registry runtime builds pinned in the lockfile.
