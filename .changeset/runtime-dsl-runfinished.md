---
'@electric-ax/agents-runtime': patch
---

Update runtime orchestration tests to use `runFinished` wakes instead of awaiting child runs inline, avoiding parent/child wake deadlocks under CI load.
