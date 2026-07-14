---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-desktop': patch
---

Preserve every deferred same-stream pull-wake notification instead of coalescing later generations, so repeated child completions reliably wake their parent.

Make desktop runtime startup failures observable and retryable even when they occur before the built-in runtime instance starts, allowing configured agents to recover after relaunch.
