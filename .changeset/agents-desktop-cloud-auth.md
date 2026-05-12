---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server-ui': patch
---

Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.
