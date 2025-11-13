---
'@electric-sql/client': patch
---

Fix race condition where collections get stuck and stop reconnecting after rapid tab switching, particularly in Firefox. The issue occurred when visibility changes happened faster than the pause/resume state machine could complete its transitions. Also fixes a memory leak where visibility change event listeners were never removed.
