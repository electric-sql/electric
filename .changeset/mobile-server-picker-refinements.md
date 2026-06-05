---
"@electric-ax/agents-mobile": patch
---

Harden the mobile kebab-menu server picker: surface connect failures in-sheet instead of silently swallowing them, persist a Cloud server only after the switch succeeds, and let the submenu close animation finish before resetting to the root page.
