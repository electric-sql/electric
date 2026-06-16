---
title: Sharing and deep links
description: Share a link that opens an agent session directly in the Electric Agents desktop or mobile app.
---

# Sharing and deep links

The Electric Agents desktop and mobile apps register the `electric-agents://`
URL scheme so a link can open a specific session directly in the app.

## Link format

```
electric-agents://open-session?server=<url-encoded server base URL>&entity=<url-encoded entity URL>
```

- `server` — the full server base URL the session lives on, including any
  Electric Cloud tenant prefix (e.g. `https://agents.electric-sql.cloud/t/svc-123/v1`).
- `entity` — the session's entity URL (e.g. `/horton/abc`).

A session is identified by **both** the server and the entity URL, so the link
carries both. The same link works on desktop and mobile.

## Sharing a link

- **Mobile:** open a session, tap **Share**, and use the **Session link** row.
  The native share sheet (and its Copy action) provides the
  `electric-agents://open-session…` link.
- **Desktop:** open a session's share dialog and use **Copy session link**.

## Opening a link

Clicking or tapping the link opens the app and navigates to the session:

- If the app is closed it launches first, then routes to the session.
- On mobile, if you are not signed in or have not set up a server, onboarding
  runs first and the session opens once setup completes.
- If the link points at a server you have not added, the app tells you instead
  of opening, on both desktop and mobile — it will not silently connect to an
  unknown server. (On mobile, if you have not finished onboarding or set up any
  server yet, onboarding runs first.) For now there is no web-browser fallback.
