---
'@electric-ax/agents-runtime': patch
---

Stabilise chat section identity across streaming updates: `buildSections` / `buildTimelineEntries` in `use-chat` now key a fingerprint-based section cache by `run.key` / `msg.key`, so settled rows return the same reference even when the upstream pipeline rebuilds row objects. Adds a bounded prune pass + a `__resetSectionCachesForTesting` hook for test isolation. Also small cleanups in `tools/context-tools.ts`.
