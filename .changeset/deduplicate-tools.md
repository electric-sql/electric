---
"@electric-ax/agents": minor
"@electric-ax/agents-server": patch
---

Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from agents-server to agents package, removing duplicate code. Tools are now exported from `@electric-ax/agents`.
