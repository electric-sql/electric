---
'@electric-ax/agents-server-ui': patch
---

Add defensive null guards for timeline run items and an error boundary around each timeline row to prevent a single malformed row from crashing the entire view.
