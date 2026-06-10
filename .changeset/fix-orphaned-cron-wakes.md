---
'@electric-ax/agents-server': patch
---

Stop orphaned cron wakes after schedule deletion by clearing stale wake-registry cache entries and ending cron tick chains once no registrations still subscribe to the cron stream.
