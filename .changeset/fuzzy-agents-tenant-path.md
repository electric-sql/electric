---
"@electric-ax/agents-runtime": patch
"@electric-ax/agents-server": patch
"@electric-ax/agents-server-conformance-tests": patch
"@electric-ax/agents": patch
"@electric-ax/agents-desktop": patch
"@electric-ax/agents-server-ui": patch
"electric-ax": patch
---

Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, and rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names.
