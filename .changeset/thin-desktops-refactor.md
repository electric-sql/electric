---
'@electric-ax/agents-desktop': patch
---

Refactor the desktop main process into focused modules so Electron bootstrap, app state, credentials, runtime lifecycle, IPC, cloud auth, and UI shell responsibilities are easier to maintain.
