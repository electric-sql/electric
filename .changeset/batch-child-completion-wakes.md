---
'@electric-ax/agents-runtime': patch
---

Batch queued child completion wakes into a single wake payload so parent agents receive every child result without extra handler runs.
