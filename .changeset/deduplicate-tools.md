---
"@electric-ax/agents-runtime": minor
"@electric-ax/agents": minor
"@electric-ax/agents-server": patch
---

Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) to the runtime package. Tools are now exported from `@electric-ax/agents-runtime`. **Breaking:** tool re-exports removed from `@electric-ax/agents` — import from `@electric-ax/agents-runtime` instead.
