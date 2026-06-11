---
'@electric-ax/agents-server': patch
---

Stop orphaned cron wakes after schedule deletion by clearing stale wake-registry entries and ending cron tick chains with no subscribers.
