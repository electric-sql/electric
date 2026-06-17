---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Batch queued child completion wakes into a single wake payload so parent agents receive every child result without extra handler runs. Preserve manifest-backed child wake registrations during spawn reconciliation and catch up late runFinished registrations so fast child completions are not missed.
