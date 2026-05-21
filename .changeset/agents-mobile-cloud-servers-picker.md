---
'@electric-ax/agents-mobile': patch
---

Surface the user's Electric Cloud agent servers in the mobile app's server-setup flow. When signed in to Electric Cloud, both the onboarding wizard's step 2 and the standalone server-setup screen now list every agent server the user can see (joined Workspace › Project › Environment › Server breadcrumb), one tap to fill in the URL. Manual URL entry still works for local / off-Cloud servers. Mirrors the desktop app's cloud-servers picker — subscribes to the same four admin-API shapes (`agent-servers`, `environments`, `projects`, `workspaces`) and joins them client-side.
