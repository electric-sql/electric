---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server-ui': patch
---

Default unauthenticated local desktop sessions to the `system:dev-local` principal and resolve optimistic send principals at mutation time so pending messages do not render as `unknown`.
