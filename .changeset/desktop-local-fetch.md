---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server-ui': patch
---

Route local desktop mutating agents-server requests through the Electron main process so CORS preflights cannot stall behind renderer connection limits.
