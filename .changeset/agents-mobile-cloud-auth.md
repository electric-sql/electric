---
'@electric-ax/agents-mobile': patch
---

Add Electric Cloud sign-in to the mobile app. New Account screen signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the desktop app and CLI use). A full-screen `<WebView>` hosts the OAuth page and intercepts the loopback callback URL via `onShouldStartLoadWithRequest` — no backend changes required. Surfaces the user's name and workspaces (via `auth.whoami`) and offers a one-tap jump to the user's Electric Cloud dashboard.
