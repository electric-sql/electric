---
'@electric-ax/agents-runtime': patch
---

Mark newly-started agent runs as failed when a wake handler errors before ending them, preventing chat UIs from showing "Thinking" indefinitely after runtime failures.
