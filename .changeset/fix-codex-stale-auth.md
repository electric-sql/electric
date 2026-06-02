---
'@electric-ax/agents-desktop': patch
---

Clear stale Codex auth in the desktop app when no usable access token can be produced, preventing the UI from showing Codex as enabled while runs cannot authenticate.
