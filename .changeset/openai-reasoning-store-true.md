---
'@electric-ax/agents': patch
---

Force `store: true` for built-in OpenAI reasoning model payloads so reasoning/tool-call continuations can replay `rs_*` reasoning items without follow-up requests failing due to missing persisted items.
