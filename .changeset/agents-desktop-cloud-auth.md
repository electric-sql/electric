---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents': patch
---

Add Electric Cloud sign-in to the desktop app. New Settings → Account panel signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the CLI uses), encrypts the resulting JWT with `safeStorage`, refreshes name + workspaces via `auth.whoami`, and offers a one-click jump to the user's Electric Cloud dashboard.

Add first-launch onboarding for Electric Cloud sign-in and LLM API keys, plus a Cloud Agent Servers settings section that syncs the user's Cloud agent servers, mints per-tenant agents tokens in the main process, and connects the desktop runtime/UI to tenant-scoped Cloud agents URLs without exposing those tokens to the renderer or `settings.json`.
