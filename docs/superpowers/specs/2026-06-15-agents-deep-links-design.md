# Design: deep links for opening sessions in the Electric Agents apps

Issue: [electric-sql/electric#4584](https://github.com/electric-sql/electric/issues/4584)

## Goal

Let a user open a specific agent session directly in the Electric Agents
**desktop (Electron)** or **mobile (Expo/React Native)** app from a link
(email, docs, chat). No deployed web UI is required for routing or fallback
in this first implementation.

## Key constraint discovered during design

A session is **not** identified by a bare id. Its address is
`server + entityUrl`:

- `entityUrl` is a server-scoped path such as `/horton/abc` or `/agent/foo/bar`.
  It already encodes the entity type in its first segment.
- The desktop app can be connected to **multiple servers** at once; mobile has
  one active server but several saved.

Therefore the deep link must carry the server as well as the entity. The
issue's literal `electric://session/{id}` is under-specified and is superseded
by the format below.

## Link format (the shared contract)

```
electric-agents://open-session?server=<encodeURIComponent(serverUrl)>&entity=<encodeURIComponent(entityUrl)>
```

- Scheme is **`electric-agents`** — the scheme the mobile app already registers
  for OAuth callbacks (`electric-agents://oauth/callback`). Reused so no second
  scheme has to be registered/migrated; desktop registers the same scheme.
- Host segment `open-session` is the action. It is deliberately **not** `session`:
  on mobile, expo-router auto-routes a deep link by its host/path, and `session`
  would collide with the internal `app/session.tsx` screen route (param mismatch,
  no server/onboarding gating → broken). `open-session` gets its own dedicated
  landing route, mirroring the existing `app/oauth/callback.tsx` pattern. Future
  entity-type-specific actions can add new hosts; for now this single host covers
  every entity kind, because `entityUrl` itself carries the type
  (`/agent/…`, `/horton/…`, …). The link format is identical on both platforms so
  a link generated on one opens on the other.
- `server` is the full server base URL, including any Cloud tenant path prefix
  (e.g. `https://agents.electric-sql.cloud/t/svc-123/v1`).
- `entity` is the `entityUrl` (leading slash optional; normalized on parse).

### Helpers

A single builder + parser pair, with a copy per platform that matches each
platform's existing conventions:

- `sessionAppUrl(serverUrl, entityUrl): string` — builds the link.
- `parseSessionDeepLink(url): { serverUrl, entityUrl } | null` — parses it.
- `isSessionDeepLink(url): boolean` — cheap prefix/host check.

Mobile parses with `expo-linking`'s `Linking.parse` (the codebase already
distrusts `new URL()` for custom schemes under Hermes — see the comment in
`cloudAuth.ts`). Desktop parses with `new URL()` (Node/Chromium handle the
custom scheme reliably).

## Desktop (Electron) — consume

### Registration

- Call `app.setAsDefaultProtocolClient('electric-agents')` early in `main.ts`
  (in dev on Windows/Linux, pass `process.execPath` + the script path so the OS
  re-launches the dev binary correctly).
- Add a `protocols:` entry to `electron-builder.yml` so packaged builds claim
  the scheme (macOS `CFBundleURLTypes`, Windows registry).

### Receiving the URL (three OS-dependent entry points)

- **macOS** (warm and cold): `app.on('open-url', (event, url) => …)`. The event
  can fire before `app.whenReady()`, so queue the URL and flush it once the
  controller exists.
- **Windows/Linux cold start**: the URL arrives as an argument in
  `process.argv`; scan argv at startup.
- **Windows/Linux warm start**: extend the **existing** `second-instance`
  handler in `main.ts` (single-instance lock is already in place) to extract the
  URL from the forwarded `argv`.

A small `extractSessionDeepLinkFromArgv(argv)` helper keeps the argv parsing
unit-testable.

### Routing into the renderer

- New IPC channel `desktop:open-session` carrying `{ serverUrl, entityUrl }`.
  The existing `DesktopCommand` union is payload-less strings, so this is a
  separate channel rather than a new command.
- Main process flow: `showOrCreateWindow()`; if the window was just created,
  wait for `did-finish-load` before sending (otherwise the listener isn't
  attached yet); then `webContents.send('desktop:open-session', payload)`.
- `preload.ts` exposes `electronAPI.onOpenSession(cb)` (returns an unsubscribe).

### Renderer behavior (`RootShell` in `agents-server-ui/src/router.tsx`)

- Subscribe to `onOpenSession`.
- Resolve `serverUrl` against `settings.servers` (reuse `cloud/server-matching`
  semantics for URL matching).
  - **Known server** → select it for the current window, then
    `navigate({ to: '/entity/$', params: { _splat: entityUrl.replace(/^\//, '') } })`.
  - **Unknown server** → show a toast: "This session is on a server you haven't
    added." (Auto-add is an explicit non-goal for v1.)

## Mobile (Expo/React Native) — consume

The `electric-agents` scheme is **already registered**; the Android
`onNewIntent` plugin already forwards warm intents. No native change required.

- Add `isSessionDeepLink` / `parseSessionDeepLink` / `sessionAppUrl` to
  `src/lib/sessionLinks.ts`.
- Capture incoming session links via the same two channels the OAuth flow uses,
  storing a **pending session link** in `MobileAppState`:
  - **cold start** — `MobileAppState.launchUrl` already holds
    `Linking.getInitialURL()`; treat it as pending when it is a session link.
  - **warm** — a `Linking.addEventListener('url', …)` global listener.
- Add a **dedicated landing route `app/open-session.tsx`** (mirroring
  `app/oauth/callback.tsx`) that owns the "switch server then open" logic, plus
  `pathname !== '/open-session'` exemptions in `RootNavigator`'s onboarding /
  server-setup redirects, and a cold-start redirect to it.
- `app/open-session.tsx` behavior:
  - parse the pending link → `{ serverUrl, entityUrl }`.
  - not onboarded / no server: `<Redirect>` into onboarding/server-setup; the
    link stays pending and re-enters once gates clear.
  - `serverUrl` resolves to a known/addable server and differs from active:
    `saveServerUrl(serverUrl)` (adding to saved servers if missing), then once
    active updates, `<Redirect href="/session?entityUrl=<entity>" />`.
  - server already active: `<Redirect href="/session?entityUrl=<entity>" />`.
  - on success, clear the pending link.
  - unknown / unaddable server: `showToast`-style inform, clear pending,
    `<Redirect href="/" />`. No auto-trust beyond saving a server URL the user
    explicitly opened.
- `RootNavigator` re-enters `/open-session` whenever a pending link exists and
  the gates are otherwise clear, so a link that arrived mid-onboarding opens
  after setup completes.

## Generating links

- Add `sessionAppUrl(serverUrl, entityUrl)` to mobile `sessionLinks.ts` and a
  mirror in `agents-server-ui/src/lib`.
- **Mobile** `ShareSessionScreen`: the "Session link" row now produces the
  `electric-agents://` app link (replacing the web link), per the issue's
  "custom protocol only, no web fallback". The native share sheet / copy action
  is unchanged.

  > **Dependency:** today nothing consumes a `session` deep link — only
  > `electric-agents://oauth/callback` is specially handled, and expo-router
  > would otherwise auto-route `electric-agents://session?…` to `app/session.tsx`
  > with mismatched params and no server context (i.e. broken). The share-screen
  > switch to app links therefore **must not ship before** the mobile consume
  > handler (section 3). Same constraint on desktop for the `ShareEntityDialog`
  > copy-link.

- **Desktop** `ShareEntityDialog`: add a "Copy session link" affordance that
  copies the app link. (The dialog currently only manages per-user grants and
  has no link feature.)

## Documentation

Add a short section under `website/docs/agents/usage/` (e.g. a "Sharing and
deep links" subsection, co-located with the share/permissions usage docs)
describing the `electric-agents://session?…` format and how to share/open a
session link on desktop and mobile.

## Testing

- **Unit tests** for the build/parse helpers on both platforms, in the style of
  the existing `sessionLinks.test.ts`: round-trip, encoded slashes in
  `entityUrl`, Cloud tenant-prefixed `server`, missing/invalid params returning
  `null`, and `isSessionDeepLink` accepting both `electric-agents://session?…`
  and the single-slash Android variant.
- **Desktop** unit test for `extractSessionDeepLinkFromArgv`.
- **Manual matrix** (not automatable in this repo's CI): app running /
  backgrounded / closed × macOS / Windows / iOS / Android. Document the steps in
  the PR.

## Out of scope (v1)

- Standard web/https session links and server-side redirects.
- Browser fallback when the app is not installed.
- Auto-adding an unknown server from a link.
- Deep links for entity types other than sessions (the format already leaves
  room for them).

## Build sequence

1. Shared link format + helpers (mobile `sessionLinks.ts`, `agents-server-ui`
   lib) with unit tests.
2. Desktop consume: registration, argv/`open-url`/`second-instance` capture,
   `desktop:open-session` IPC, preload bridge, `RootShell` routing.
3. Mobile consume: pending-link capture in `MobileAppState`, `RootNavigator`
   gate handling, navigation.
4. Generate: mobile `ShareSessionScreen` app link; desktop `ShareEntityDialog`
   copy-link.
5. Docs.
6. Manual verification across the platform matrix.
