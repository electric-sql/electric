---
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents-mobile': patch
---

Per-runner recent working directories in the spawn UI, derived from the synced sessions list so the same recents appear on every device. The desktop picker becomes per-runner (replacing the localStorage list), and mobile gains sandbox-profile and working-directory selection — including sending the sandbox profile on spawn, without which the runtime ignores the chosen directory.
