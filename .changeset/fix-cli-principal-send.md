---
'electric-ax': patch
'@electric-ax/agents-server-ui': patch
---

Stop CLI and web UI sends from posting legacy `from` attribution and derive message senders from the authenticated Electric principal instead. The CLI now sends a default `Electric-Principal` header of `system:cli-<os-username>` when no explicit principal is configured.
