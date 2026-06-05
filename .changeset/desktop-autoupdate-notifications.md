---
"@electric-ax/agents-desktop": patch
---

Wire `electron-updater` so the desktop app can detect new releases. Phase
one of two:

* Adds a working **Check for Updates…** menu item (Electric Agents menu
  on macOS, Help menu on Windows/Linux, plus the in-window app-icon
  menu) and a quiet background check ~10s after launch.
* On Windows/Linux, signed-platform flow is wired end-to-end: downloads
  in the background with a dock/taskbar progress bar, then prompts
  "Restart now" to apply via `quitAndInstall()`.
* On macOS, ships as **notify-only** until Developer ID signing lands —
  Squirrel.Mac can't swap an unsigned bundle, so we skip the download
  entirely and prompt to open the GitHub releases page instead.
* Switches the publish provider from `github` to `generic` pointed at
  the moving `agents-desktop-latest` tag, because the repo's overall
  "latest" release is shared across packages and the GitHub provider
  was picking the wrong one.
* Adds channel separation so canary builds publish to the `beta`
  channel against an `agents-desktop-canary` URL — stable users never
  auto-update to canaries.
