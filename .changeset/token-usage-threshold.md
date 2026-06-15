---
'@electric-ax/agents-server-ui': patch
---

Hide the per-response token-usage label when the combined input + output
count falls below a threshold (`SHOW_USAGE_THRESHOLD`, currently 1000).
Tiny tool-only steps and one-line replies no longer clutter the meta row
with noise like `47 ↑ 12 ↓`; the threshold lives in a single constant so
it's easy to tune.
