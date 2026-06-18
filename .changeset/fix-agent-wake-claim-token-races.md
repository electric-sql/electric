---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Fix agent wake handling so concurrent sessions do not invalidate each other's claim write tokens, and retry same-stream wakes after the active wake drains instead of dropping pending work.
