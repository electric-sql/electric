---
'@electric-ax/agents-server-ui': patch
---

Refactor the new-session prompt form. Move the working-directory and runner pickers out of the composer's inline pill row into a "session context" tray that tucks under the composer's curved bottom edge (mirrors the chat screen's `<EntityContextDrawer>` pattern, just flipped). Give the runner picker visual parity with the working-directory picker via a new optional leading-icon slot on `Select.Trigger`, and reword the working-directory "None" option to "Don't work in a directory".
