---
'@electric-ax/agents-runtime': patch
---

Preserve volatile context source order in `assembleContext()` instead of globally sorting by `at` timestamp. Fixes a bug where the SIGINT reordering performed by `reorderInterruptedRuns()` was undone by a downstream sort, causing interrupted run output to appear after the interrupt marker in the model transcript.
