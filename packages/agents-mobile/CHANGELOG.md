# @electric-ax/agents-mobile

## 0.0.1

### Patch Changes

- ca01b9d: Add the React Native agents mobile app package.
- 8fd9bfa: Add Electric Cloud sign-in to the mobile app. New Account screen signs in via GitHub or Google through `dashboard.electric-sql.cloud`'s loopback OAuth flow (the same one the desktop app and CLI use). A full-screen `<WebView>` hosts the OAuth page and intercepts the loopback callback URL via `onShouldStartLoadWithRequest` — no backend changes required. Surfaces the user's name and workspaces (via `auth.whoami`) and offers a one-tap jump to the user's Electric Cloud dashboard.
- 64d9354: Connect the Electric mobile app to Electric Cloud agent servers end-to-end. Trade the dashboard JWT for a per-service agents token, inject `Authorization`/`x-electric-service`/`electric-principal` on every outbound request (via `serverFetch` + `fetchClient` on shape collections, including the React Native long-poll `DurableStream`), forward those headers across the Expo DOM-embed boundary as a prop so the embed's own `auth-fetch` instance picks them up, switch URL composition to `appendPathToUrl` (Cloud URLs carry `?service=…`), spawn via the canonical `/_electric/entities/<type>/<name>` endpoint with `initialMessage` in the body (fixes a STREAM_NOT_FOUND race), and add a runner picker so users target a specific pull-wake runner.
- 508742f: Surface the user's Electric Cloud agent servers in the mobile app's server-setup flow. When signed in to Electric Cloud, both the onboarding wizard's step 2 and the standalone server-setup screen now list every agent server the user can see (joined Workspace › Project › Environment › Server breadcrumb), one tap to fill in the URL. Manual URL entry still works for local / off-Cloud servers. Mirrors the desktop app's cloud-servers picker — subscribes to the same four admin-API shapes (`agent-servers`, `environments`, `projects`, `workspaces`) and joins them client-side.
- Updated dependencies [ca01b9d]
- Updated dependencies [64d9354]
- Updated dependencies [9f10b20]
  - @electric-ax/agents-runtime@0.3.1
  - @electric-ax/agents-server-ui@0.4.6
