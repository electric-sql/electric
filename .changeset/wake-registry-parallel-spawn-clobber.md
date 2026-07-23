---
"@electric-ax/agents-server": patch
---

Fix a dropped parent wake when a parent spawns sub-agents in parallel. Each child's `runFinished` wake is registered from two paths (spawn + manifest-sync) keyed by the same `manifestKey`; the second insert hits `uq_wake_registration` and takes the conflict branch. That branch called `loadRegistrations()`, a full clear-and-rebuild of the in-memory registration cache from a snapshot read across an `await`. Under parallel spawn several such reloads interleave, and a stale snapshot landing last evicts a sibling's newer registration from the cache — so when that sibling finishes, `evaluate()` finds no match and the wake is silently dropped (no error). Sequential spawn never overlaps the reloads, which is why only the parallel fan-out reproduced it. The conflict branch now re-reads only the single conflicting row and caches just that entry, leaving sibling registrations untouched.
