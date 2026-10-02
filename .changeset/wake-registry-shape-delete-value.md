---
'@electric-ax/agents-server': patch
---

Fix `runFinished` child wakes being delivered only for the last child spawned. The wake registry read the deleted row id from `old_value` on shape delete messages, but Electric's `replica: full` deletes carry the row in `value`, so every delete reset the whole in-memory registration cache (and the shape log replayed those deletes on restart). Read the id from `value` first and only fall back to a full reset when no id is available.
