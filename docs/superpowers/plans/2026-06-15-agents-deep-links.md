# Electric Agents Deep Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users open a specific agent session directly in the Electric Agents desktop (Electron) and mobile (Expo/RN) apps via an `electric-agents://open-session?server=…&entity=…` deep link.

**Architecture:** A shared, self-contained link format carries both the server base URL and the server-scoped `entityUrl`. Desktop registers the `electric-agents` scheme and routes incoming links through a new `desktop:open-session` IPC channel into the renderer's hash router. Mobile reuses its already-registered `electric-agents` scheme, captures links via a global `Linking` listener + cold-start initial URL, and routes through a dedicated `app/open-session.tsx` landing route that mirrors the existing OAuth-callback flow. Share UIs on both platforms generate the same app link.

**Tech Stack:** Electron (main + preload + Vite renderer), TanStack Router (hash history) in `agents-server-ui`, Expo Router + `expo-linking` in `agents-mobile`, Vitest for unit tests.

---

## File Structure

**Shared link helpers (one small copy per package — these packages have no shared util lib, and `sessionLinks` is already duplicated this way):**

- `packages/agents-mobile/src/lib/sessionLinks.ts` (modify) — builder + parser + matcher; mobile consumes and generates.
- `packages/agents-server-ui/src/lib/sessionLinks.ts` (create) — builder only; the desktop renderer generates links in `ShareEntityDialog`.
- `packages/agents-desktop/src/shared/deep-link.ts` (create) — parser + matcher + argv extractor; the desktop main process consumes links.

**Desktop consume:**

- `packages/agents-desktop/src/shared/types.ts` (modify) — add `OpenSessionPayload`.
- `packages/agents-desktop/src/main.ts` (modify) — register scheme, `open-url`, argv, `second-instance`.
- `packages/agents-desktop/src/app/controller.ts` (modify) — `openSessionFromDeepLink`.
- `packages/agents-desktop/src/preload.ts` (modify) — `onOpenSession`.
- `packages/agents-desktop/electron-builder.yml` (modify) — `protocols`.
- `packages/agents-server-ui/src/lib/server-connection.ts` (modify) — add `onOpenSession` to the `electronAPI` Window type.
- `packages/agents-server-ui/src/router.tsx` (modify) — subscribe + route.

**Mobile consume:**

- `packages/agents-mobile/src/lib/MobileAppState.tsx` (modify) — pending-link state + warm listener.
- `packages/agents-mobile/app/open-session.tsx` (create) — landing route.
- `packages/agents-mobile/app/_layout.tsx` (modify) — gating exemptions + re-entry.

**Generate + docs:**

- `packages/agents-mobile/src/screens/ShareSessionScreen.tsx` (modify) — emit app link.
- `packages/agents-server-ui/src/components/ShareEntityDialog.tsx` (modify) — copy session link.
- `website/docs/agents/usage/sharing-and-deep-links.md` (create) — docs.

---

## Phase 1 — Shared link helpers

### Task 1: Mobile link helpers (`sessionLinks.ts`)

**Files:**

- Modify: `packages/agents-mobile/src/lib/sessionLinks.ts`
- Test: `packages/agents-mobile/src/lib/sessionLinks.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `packages/agents-mobile/src/lib/sessionLinks.test.ts`:

```ts
import {
  isSessionDeepLink,
  parseSessionDeepLink,
  sessionAppUrl,
} from './sessionLinks'

describe(`sessionAppUrl`, () => {
  it(`builds an app deep link with encoded server and entity`, () => {
    expect(sessionAppUrl(`https://host.example`, `/horton/abc`)).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fhost.example&entity=horton%2Fabc`
    )
  })

  it(`preserves a Cloud tenant path prefix in the server param`, () => {
    expect(
      sessionAppUrl(`https://agents.electric-sql.cloud/t/svc-123/v1`, `/x/y`)
    ).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fagents.electric-sql.cloud%2Ft%2Fsvc-123%2Fv1&entity=x%2Fy`
    )
  })
})

describe(`isSessionDeepLink`, () => {
  it(`accepts the canonical form`, () => {
    expect(
      isSessionDeepLink(`electric-agents://open-session?server=a&entity=b`)
    ).toBe(true)
  })
  it(`accepts the single-slash Android variant`, () => {
    expect(
      isSessionDeepLink(`electric-agents:/open-session?server=a&entity=b`)
    ).toBe(true)
  })
  it(`rejects the oauth callback and other schemes`, () => {
    expect(isSessionDeepLink(`electric-agents://oauth/callback?x=1`)).toBe(
      false
    )
    expect(isSessionDeepLink(`https://host.example/x`)).toBe(false)
  })
})

describe(`parseSessionDeepLink`, () => {
  it(`round-trips a built link`, () => {
    const url = sessionAppUrl(`https://host.example`, `/horton/abc`)
    expect(parseSessionDeepLink(url)).toEqual({
      serverUrl: `https://host.example`,
      entityUrl: `/horton/abc`,
    })
  })
  it(`normalizes a missing leading slash on entity`, () => {
    expect(
      parseSessionDeepLink(
        `electric-agents://open-session?server=https%3A%2F%2Fh.example&entity=horton%2Fabc`
      )
    ).toEqual({ serverUrl: `https://h.example`, entityUrl: `/horton/abc` })
  })
  it(`returns null when a param is missing`, () => {
    expect(
      parseSessionDeepLink(`electric-agents://open-session?server=a`)
    ).toBeNull()
    expect(parseSessionDeepLink(`electric-agents://oauth/callback`)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/agents-mobile && pnpm vitest run src/lib/sessionLinks.test.ts`
Expected: FAIL — `isSessionDeepLink`/`parseSessionDeepLink`/`sessionAppUrl` are not exported.

- [ ] **Step 3: Implement the helpers**

Append to `packages/agents-mobile/src/lib/sessionLinks.ts`:

```ts
import * as Linking from 'expo-linking'

const SESSION_DEEP_LINK_SCHEME = `electric-agents`
const SESSION_DEEP_LINK_HOST = `open-session`

/**
 * App deep link that opens a session directly in the Electric Agents app.
 * Carries the full server base URL (incl. any Cloud tenant prefix) and the
 * server-scoped entity url, both URL-encoded. Host is `open-session` (not
 * `session`) so expo-router doesn't auto-route it to the internal /session
 * screen — a dedicated landing route handles it.
 */
export function sessionAppUrl(serverUrl: string, entityUrl: string): string {
  const server = encodeURIComponent(serverUrl.replace(/\/+$/, ``))
  const entity = encodeURIComponent(sessionIdFromEntityUrl(entityUrl))
  return `${SESSION_DEEP_LINK_SCHEME}://${SESSION_DEEP_LINK_HOST}?server=${server}&entity=${entity}`
}

/**
 * Loose match for "is this our open-session deep link?". Accepts both
 * `electric-agents://open-session` and the single-slash Android variant
 * `electric-agents:/open-session` (the OS occasionally collapses the slashes),
 * mirroring `cloudAuth.isCallbackUrl`.
 */
export function isSessionDeepLink(url: string): boolean {
  if (typeof url !== `string`) return false
  const prefix = `${SESSION_DEEP_LINK_SCHEME}:`
  if (!url.startsWith(prefix)) return false
  const rest = url.slice(prefix.length).replace(/^\/+/, ``)
  return rest.startsWith(SESSION_DEEP_LINK_HOST)
}

export function parseSessionDeepLink(
  url: string
): { serverUrl: string; entityUrl: string } | null {
  if (!isSessionDeepLink(url)) return null
  let parsed: ReturnType<typeof Linking.parse>
  try {
    parsed = Linking.parse(url)
  } catch {
    return null
  }
  const params = parsed.queryParams ?? {}
  const server = pickString(params.server)
  const entity = pickString(params.entity)
  if (!server || !entity) return null
  return { serverUrl: server, entityUrl: `/${entity.replace(/^\/+/, ``)}` }
}

function pickString(
  value: string | Array<string> | null | undefined
): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === `string` ? value : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents-mobile && pnpm vitest run src/lib/sessionLinks.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mobile/src/lib/sessionLinks.ts packages/agents-mobile/src/lib/sessionLinks.test.ts
git commit -m "feat(agents-mobile): add open-session deep-link helpers"
```

---

### Task 2: Desktop renderer link builder (`agents-server-ui/src/lib/sessionLinks.ts`)

**Files:**

- Create: `packages/agents-server-ui/src/lib/sessionLinks.ts`
- Test: `packages/agents-server-ui/src/lib/sessionLinks.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents-server-ui/src/lib/sessionLinks.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sessionAppUrl } from './sessionLinks'

describe(`sessionAppUrl`, () => {
  it(`builds an app deep link with encoded server and entity`, () => {
    expect(sessionAppUrl(`https://host.example`, `/horton/abc`)).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fhost.example&entity=horton%2Fabc`
    )
  })
  it(`strips a trailing slash from the server url`, () => {
    expect(sessionAppUrl(`https://host.example/`, `horton/abc`)).toBe(
      `electric-agents://open-session?server=https%3A%2F%2Fhost.example&entity=horton%2Fabc`
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents-server-ui && pnpm vitest run src/lib/sessionLinks.test.ts`
Expected: FAIL — module not found / `sessionAppUrl` not exported.

- [ ] **Step 3: Implement**

Create `packages/agents-server-ui/src/lib/sessionLinks.ts`:

```ts
/**
 * App deep link that opens a session in the Electric Agents desktop/mobile app.
 * Mirrors `agents-mobile`'s `sessionAppUrl`. Carries the full server base URL
 * (incl. any Cloud tenant prefix) and the server-scoped entity url, URL-encoded.
 */
export function sessionAppUrl(serverUrl: string, entityUrl: string): string {
  const server = encodeURIComponent(serverUrl.replace(/\/+$/, ``))
  const entity = encodeURIComponent(entityUrl.replace(/^\/+/, ``))
  return `electric-agents://open-session?server=${server}&entity=${entity}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents-server-ui && pnpm vitest run src/lib/sessionLinks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/lib/sessionLinks.ts packages/agents-server-ui/src/lib/sessionLinks.test.ts
git commit -m "feat(agents-server-ui): add session app-link builder"
```

---

### Task 3: Desktop main-process deep-link parser (`agents-desktop/src/shared/deep-link.ts`)

**Files:**

- Create: `packages/agents-desktop/src/shared/deep-link.ts`
- Test: `packages/agents-desktop/src/shared/deep-link.test.ts`

- [ ] **Step 1: Write failing test**

Create `packages/agents-desktop/src/shared/deep-link.test.ts`:

```ts
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extractSessionDeepLinkFromArgv,
  isSessionDeepLink,
  parseSessionDeepLink,
} from './deep-link.ts'

test(`isSessionDeepLink matches only open-session links`, () => {
  assert.equal(
    isSessionDeepLink(`electric-agents://open-session?server=a&entity=b`),
    true
  )
  assert.equal(isSessionDeepLink(`electric-agents://oauth/callback`), false)
  assert.equal(isSessionDeepLink(`https://x.example`), false)
})

test(`parseSessionDeepLink extracts server and entity`, () => {
  assert.deepEqual(
    parseSessionDeepLink(
      `electric-agents://open-session?server=${encodeURIComponent(
        `https://host.example`
      )}&entity=${encodeURIComponent(`horton/abc`)}`
    ),
    { serverUrl: `https://host.example`, entityUrl: `/horton/abc` }
  )
})

test(`parseSessionDeepLink returns null on missing params`, () => {
  assert.equal(
    parseSessionDeepLink(`electric-agents://open-session?server=a`),
    null
  )
})

test(`extractSessionDeepLinkFromArgv finds the link argument`, () => {
  const link = `electric-agents://open-session?server=a&entity=b`
  assert.equal(
    extractSessionDeepLinkFromArgv([`/path/to/app`, `--foo`, link]),
    link
  )
  assert.equal(extractSessionDeepLinkFromArgv([`/path/to/app`]), null)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents-desktop && node --test --experimental-strip-types src/shared/deep-link.test.ts`
Expected: FAIL — module `./deep-link.ts` does not exist.

> Note: this matches the existing desktop test style (`node:test` + `assert`, e.g. `src/cloud/server-fetch.test.ts`). If that suite is run via a different command in CI, use the same command; the `coverage` script in this package is a no-op.

- [ ] **Step 3: Implement**

Create `packages/agents-desktop/src/shared/deep-link.ts`:

```ts
const SESSION_DEEP_LINK_SCHEME = `electric-agents`
const SESSION_DEEP_LINK_HOST = `open-session`

export function isSessionDeepLink(url: string): boolean {
  if (typeof url !== `string`) return false
  const prefix = `${SESSION_DEEP_LINK_SCHEME}:`
  if (!url.startsWith(prefix)) return false
  const rest = url.slice(prefix.length).replace(/^\/+/, ``)
  return rest.startsWith(SESSION_DEEP_LINK_HOST)
}

export function parseSessionDeepLink(
  url: string
): { serverUrl: string; entityUrl: string } | null {
  if (!isSessionDeepLink(url)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  const server = parsed.searchParams.get(`server`)
  const entity = parsed.searchParams.get(`entity`)
  if (!server || !entity) return null
  return { serverUrl: server, entityUrl: `/${entity.replace(/^\/+/, ``)}` }
}

/**
 * Pull an `electric-agents://open-session?…` URL out of a process argv array.
 * On Windows/Linux the OS delivers deep links as a command-line argument
 * (cold start in `process.argv`, warm start via the `second-instance` event).
 */
export function extractSessionDeepLinkFromArgv(
  argv: ReadonlyArray<string>
): string | null {
  for (const arg of argv) {
    if (isSessionDeepLink(arg)) return arg
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents-desktop && node --test --experimental-strip-types src/shared/deep-link.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agents-desktop/src/shared/deep-link.ts packages/agents-desktop/src/shared/deep-link.test.ts
git commit -m "feat(agents-desktop): add open-session deep-link parser"
```

---

## Phase 2 — Desktop consume

### Task 4: Add `OpenSessionPayload` type and `desktop:open-session` IPC plumbing

**Files:**

- Modify: `packages/agents-desktop/src/shared/types.ts` (after the `DesktopCommand` union, around line 230)
- Modify: `packages/agents-desktop/src/preload.ts` (in the `onDesktopCommand` neighborhood, ~line 230)
- Modify: `packages/agents-server-ui/src/lib/server-connection.ts` (the `electronAPI` Window interface, after `onDesktopCommand?`, ~line 410)

- [ ] **Step 1: Add the payload type**

In `packages/agents-desktop/src/shared/types.ts`, immediately after the `DesktopCommand` union, add:

```ts
export type OpenSessionPayload = {
  /** Resolved saved-server id, or null when the link's server is unknown. */
  serverId: string | null
  /** The link's raw server base URL (used for the unknown-server message). */
  serverUrl: string
  /** Server-scoped entity url, e.g. `/horton/abc`. */
  entityUrl: string
}
```

- [ ] **Step 2: Expose `onOpenSession` in the preload bridge**

In `packages/agents-desktop/src/preload.ts`, add `OpenSessionPayload` to the type import from `./shared/types`, then add this method right after the `onDesktopCommand` method in the `exposeInMainWorld` object:

```ts
  onOpenSession: (
    callback: (payload: OpenSessionPayload) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: OpenSessionPayload
    ) => callback(payload)
    ipcRenderer.on(`desktop:open-session`, listener)
    return () => ipcRenderer.removeListener(`desktop:open-session`, listener)
  },
```

- [ ] **Step 3: Declare `onOpenSession` on the renderer's `electronAPI` type**

In `packages/agents-server-ui/src/lib/server-connection.ts`, inside the `electronAPI?: { … }` Window interface, right after the `onDesktopCommand?` entry add:

```ts
      onOpenSession?: (
        callback: (payload: {
          serverId: string | null
          serverUrl: string
          entityUrl: string
        }) => void
      ) => () => void
```

- [ ] **Step 4: Typecheck both packages**

Run: `cd packages/agents-desktop && pnpm typecheck && cd ../agents-server-ui && pnpm typecheck`
Expected: PASS (no type errors).

- [ ] **Step 5: Commit**

```bash
git add packages/agents-desktop/src/shared/types.ts packages/agents-desktop/src/preload.ts packages/agents-server-ui/src/lib/server-connection.ts
git commit -m "feat(agents-desktop): add desktop:open-session IPC plumbing"
```

---

### Task 5: Resolve + dispatch the deep link in the controller

**Files:**

- Modify: `packages/agents-desktop/src/app/controller.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/agents-desktop/src/app/controller.ts`, add to the existing import groups:

```ts
import { findSavedServerForUrl } from '../cloud/server-matching'
import { parseSessionDeepLink } from '../shared/deep-link'
import type { OpenSessionPayload } from '../shared/types'
```

(`OpenSessionPayload` can be added to the existing `import type { … } from '../shared/types'` block instead of a new line.)

- [ ] **Step 2: Add the `openSessionFromDeepLink` function inside `createDesktopMainController`**

Add this near the other window helpers (e.g. just after `showOrCreateWindow`):

```ts
const sendOpenSessionToWindow = (
  win: BrowserWindow,
  payload: OpenSessionPayload
): void => {
  if (win.webContents.isLoading()) {
    win.webContents.once(`did-finish-load`, () => {
      win.webContents.send(`desktop:open-session`, payload)
    })
  } else {
    win.webContents.send(`desktop:open-session`, payload)
  }
}

const openSessionFromDeepLink = (url: string): void => {
  const parsed = parseSessionDeepLink(url)
  if (!parsed) {
    console.warn(`[agents-desktop] Ignoring malformed deep link: ${url}`)
    return
  }
  const matched = findSavedServerForUrl(settings.servers, parsed.serverUrl)
  const payload: OpenSessionPayload = {
    serverId: matched?.id ?? null,
    serverUrl: parsed.serverUrl,
    entityUrl: parsed.entityUrl,
  }
  const existing = [...windows].find((win) => !win.isDestroyed())
  if (existing) {
    existing.show()
    existing.focus()
    sendOpenSessionToWindow(existing, payload)
    return
  }
  const win = createWindow()
  sendOpenSessionToWindow(win, payload)
}
```

- [ ] **Step 3: Export it from the controller's returned object**

In the `return { … }` object at the bottom of `createDesktopMainController`, add:

```ts
    openSessionFromDeepLink,
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/agents-desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-desktop/src/app/controller.ts
git commit -m "feat(agents-desktop): resolve and dispatch open-session deep links"
```

---

### Task 6: Register the scheme and wire OS entry points in `main.ts`

**Files:**

- Modify: `packages/agents-desktop/src/main.ts`

- [ ] **Step 1: Import the argv extractor**

Add near the top imports of `packages/agents-desktop/src/main.ts`:

```ts
import { extractSessionDeepLinkFromArgv } from './shared/deep-link'
```

- [ ] **Step 2: Register the protocol client and add a pending-URL queue**

Immediately after the `desktopController = createDesktopMainController(desktopContext)` line, add:

```ts
// Claim the `electric-agents://` scheme so the OS routes deep links to us.
// In dev on Windows/Linux the OS must relaunch the actual dev binary, so we
// pass execPath + the entry script explicitly.
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(`electric-agents`, process.execPath, [
    path.resolve(process.argv[1]!),
  ])
} else {
  app.setAsDefaultProtocolClient(`electric-agents`)
}

// `open-url` (macOS) can fire before the app is ready; queue until then.
let pendingDeepLink: string | null = null
function dispatchDeepLink(url: string): void {
  if (!app.isReady() || !desktopController) {
    pendingDeepLink = url
    return
  }
  desktopController.openSessionFromDeepLink(url)
}

app.on(`open-url`, (event, url) => {
  event.preventDefault()
  dispatchDeepLink(url)
})
```

- [ ] **Step 3: Handle Windows/Linux warm start in the existing `second-instance` handler**

In `main.ts`, replace the existing `second-instance` handler body with one that also checks argv for a deep link:

```ts
app.on(`second-instance`, (_event, argv) => {
  const deepLink = extractSessionDeepLinkFromArgv(argv)
  if (deepLink) {
    desktopController?.openSessionFromDeepLink(deepLink)
    return
  }
  if (LoginItems.shouldOpenWindowForSecondInstance(argv)) {
    desktopController?.showOrCreateWindow()
  }
})
```

- [ ] **Step 4: Flush cold-start links at the end of `main()`**

At the end of the `main()` function (after `controller.initializeUpdater()`), add:

```ts
// Windows/Linux cold start: the deep link is an argv entry. macOS cold
// start: `open-url` already fired and stashed it in `pendingDeepLink`.
const argvDeepLink = extractSessionDeepLinkFromArgv(process.argv)
const coldStartLink = pendingDeepLink ?? argvDeepLink
if (coldStartLink) {
  pendingDeepLink = null
  controller.openSessionFromDeepLink(coldStartLink)
}
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/agents-desktop && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/agents-desktop/src/main.ts
git commit -m "feat(agents-desktop): register electric-agents scheme and route deep links"
```

---

### Task 7: Declare the scheme in `electron-builder.yml`

**Files:**

- Modify: `packages/agents-desktop/electron-builder.yml`

- [ ] **Step 1: Add the `protocols` block**

In `packages/agents-desktop/electron-builder.yml`, add a top-level `protocols:` key (place it just before the `mac:` section):

```yaml
protocols:
  - name: Electric Agents
    schemes:
      - electric-agents
```

> `electron-builder` applies `protocols` to macOS (`CFBundleURLTypes`) and Windows automatically.

- [ ] **Step 2: Verify the YAML parses**

Run: `cd packages/agents-desktop && node -e "import('js-yaml').then(y=>console.log(!!y.load(require('fs').readFileSync('electron-builder.yml','utf8'))))" 2>/dev/null || echo "js-yaml not present; visually confirm indentation"`
Expected: `true`, or the fallback message (then visually confirm the new block is indented like the file's other top-level keys).

- [ ] **Step 3: Commit**

```bash
git add packages/agents-desktop/electron-builder.yml
git commit -m "feat(agents-desktop): declare electric-agents protocol for packaged builds"
```

---

### Task 8: Route incoming links in the renderer (`router.tsx`)

**Files:**

- Modify: `packages/agents-server-ui/src/router.tsx`

- [ ] **Step 1: Add imports**

In `packages/agents-server-ui/src/router.tsx`, add:

```ts
import { showToast } from './lib/toast'
import { useServerConnection } from './hooks/useServerConnection'
```

> `useServerConnection` is a **context** hook backed by `ServerConnectionProvider`, which `App.tsx` mounts above `<RouterProvider>`. So calling it in `RootShell` reads the same shared instance (no double-subscribe). It exposes `servers: Array<ServerConfig>`, `activeServer`, and `setActiveServer(server)`.

- [ ] **Step 2: Subscribe to `onOpenSession` inside `RootShell`**

Inside the `RootShell` component, alongside the existing `useEffect` that wires `onDesktopCommand`, add a new effect. Place it after `navigateToEntity` is defined (so it can reuse it):

```ts
const { servers, setActiveServer } = useServerConnection()
useEffect(() => {
  const off = window.electronAPI?.onOpenSession?.((payload) => {
    if (!payload.serverId) {
      showToast({
        title: `Can't open this session`,
        description: `It lives on a server you haven't added (${payload.serverUrl}).`,
        tone: `warning`,
      })
      return
    }
    const target = servers.find((s) => s.id === payload.serverId)
    if (target) setActiveServer(target)
    navigateToEntity(payload.entityUrl)
  })
  return () => off?.()
}, [servers, setActiveServer, navigateToEntity])
```

> `navigateToEntity` already strips the leading slash and navigates to `/entity/$` (defined earlier in `RootShell`). `setActiveServer` registers the active base URL via `useServerConnection`'s existing effect, so the entity stream loads against the right server.

- [ ] **Step 3: Typecheck**

Run: `cd packages/agents-server-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Manual smoke test (desktop dev)**

Run the desktop app in dev (`cd packages/agents-desktop && pnpm dev`), connect to a local server, open a session, copy its `entityUrl` from the address/hash, then from a terminal run:
`open "electric-agents://open-session?server=$(node -e 'process.stdout.write(encodeURIComponent("http://localhost:<port>"))')&entity=$(node -e 'process.stdout.write(encodeURIComponent("<entityUrl>"))')"`
Expected: the running app focuses and navigates to that session. With an unknown server URL, expect the warning toast.

> In dev, macOS registers the scheme against the Electron dev binary, so `open` may route to a second instance or not at all depending on how dev is launched. If dev routing is flaky, defer the authoritative check to the packaged-build matrix in Task 16 and note it in the PR.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/router.tsx
git commit -m "feat(agents-server-ui): open sessions from desktop deep links"
```

---

## Phase 3 — Mobile consume

### Task 9: Pending-link capture in `MobileAppState`

**Files:**

- Modify: `packages/agents-mobile/src/lib/MobileAppState.tsx`

- [ ] **Step 1: Import the matcher**

Add to the imports in `packages/agents-mobile/src/lib/MobileAppState.tsx`:

```ts
import { isSessionDeepLink } from './sessionLinks'
```

- [ ] **Step 2: Extend the context type**

In the `MobileAppState` type, add:

```ts
  /** Most recent open-session deep link awaiting routing, or null. */
  pendingSessionLink: string | null
  setPendingSessionLink: (next: string | null) => void
```

- [ ] **Step 3: Add state and seed it from the cold-start URL**

In `MobileAppStateProvider`, add state next to the others:

```ts
const [pendingSessionLink, setPendingSessionLink] = useState<string | null>(
  null
)
```

In the initial-load effect, after `setLaunchUrl(initialUrl)`, add:

```ts
if (initialUrl && isSessionDeepLink(initialUrl)) {
  setPendingSessionLink(initialUrl)
}
```

- [ ] **Step 4: Add a warm-start global listener**

Add a new effect in `MobileAppStateProvider` (after the initial-load effect):

```ts
useEffect(() => {
  const subscription = Linking.addEventListener(`url`, ({ url }) => {
    if (isSessionDeepLink(url)) setPendingSessionLink(url)
  })
  return () => subscription.remove()
}, [])
```

- [ ] **Step 5: Expose the new fields in the context value**

In the `useMemo` value object, add `pendingSessionLink` and `setPendingSessionLink`, and add both to the `useMemo` dependency array:

```ts
      pendingSessionLink,
      setPendingSessionLink,
```

- [ ] **Step 6: Typecheck**

Run: `cd packages/agents-mobile && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/agents-mobile/src/lib/MobileAppState.tsx
git commit -m "feat(agents-mobile): capture pending open-session deep links"
```

---

### Task 10: Landing route `app/open-session.tsx`

**Files:**

- Create: `packages/agents-mobile/app/open-session.tsx`

- [ ] **Step 1: Implement the landing route**

Create `packages/agents-mobile/app/open-session.tsx`:

```tsx
import { useEffect, useMemo } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Redirect } from 'expo-router'
import { useMobileAppState } from '../src/lib/MobileAppState'
import { parseSessionDeepLink } from '../src/lib/sessionLinks'
import { addSavedServer, getSavedServers } from '../src/lib/savedServers'
import { getCloudServiceIdFromServerUrl } from '../src/lib/cloudAgentUrls'
import { useTokens } from '../src/lib/ThemeProvider'

/**
 * Landing route for `electric-agents://open-session?server=…&entity=…`.
 *
 * Mirrors `app/oauth/callback.tsx`: render-phase `<Redirect>` (not
 * effect-driven navigation, which races Expo Router's intent handling).
 * The root navigator routes here on cold start and re-enters whenever a
 * pending link exists and the onboarding/server gates are clear.
 */
export default function OpenSessionRoute(): React.ReactElement {
  const {
    pendingSessionLink,
    launchUrl,
    setPendingSessionLink,
    serverUrl,
    saveServerUrl,
    onboardingDismissed,
  } = useMobileAppState()
  const tokens = useTokens()
  const styles = useMemo(() => createStyles(tokens), [tokens])

  const target = useMemo(
    () => parseSessionDeepLink(pendingSessionLink ?? launchUrl ?? ``),
    [pendingSessionLink, launchUrl]
  )

  // Switch the active server before we navigate, if needed and resolvable.
  useEffect(() => {
    if (!target) return
    if (!onboardingDismissed || !serverUrl) return
    const normalized = target.serverUrl.replace(/\/+$/, ``)
    if (normalized === serverUrl.replace(/\/+$/, ``)) return
    // Only self-hosted servers can be auto-added from a link; cloud servers
    // require sign-in and are intentionally left to the inform path.
    if (getCloudServiceIdFromServerUrl(normalized) !== null) return
    if (!getSavedServers().some((s) => s.url === normalized)) {
      addSavedServer({
        id: normalized,
        name: hostOf(normalized),
        url: normalized,
        source: `manual`,
      })
    }
    void saveServerUrl(normalized)
  }, [target, onboardingDismissed, serverUrl, saveServerUrl])

  if (!target) {
    setPendingSessionLink(null)
    return <Redirect href="/" />
  }

  // Gates not clear yet — let the root navigator run onboarding/setup; the
  // link stays pending and we re-enter once a server exists.
  if (!onboardingDismissed) return <Redirect href="/onboarding" />
  if (!serverUrl) return <Redirect href="/server-setup" />

  const normalized = target.serverUrl.replace(/\/+$/, ``)
  const activeMatches = normalized === serverUrl.replace(/\/+$/, ``)
  const isCloudUnaddable =
    !activeMatches && getCloudServiceIdFromServerUrl(normalized) !== null

  if (isCloudUnaddable) {
    // Can't silently switch to a cloud server; inform and bail.
    setPendingSessionLink(null)
    return <Redirect href="/" />
  }

  // Wait for the server switch (effect above) to land before navigating.
  if (!activeMatches) {
    return (
      <View style={styles.root}>
        <ActivityIndicator color={tokens.accent11} />
      </View>
    )
  }

  setPendingSessionLink(null)
  return (
    <Redirect
      href={{ pathname: `/session`, params: { entityUrl: target.entityUrl } }}
    />
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

function createStyles(tokens: ReturnType<typeof useTokens>) {
  return StyleSheet.create({
    root: {
      flex: 1,
      alignItems: `center`,
      justifyContent: `center`,
      backgroundColor: tokens.bg,
    },
  })
}
```

> Calling `setPendingSessionLink(null)` during render is intentional and mirrors the codebase's render-phase navigation choice in `oauth/callback.tsx`; it schedules a state update on the provider and the immediate `<Redirect>` leaves this route. If the project's React version warns about set-state-in-render here, move the three `setPendingSessionLink(null)` calls into a `useEffect` guarded by a ref (same `dispatchedRef` pattern as `oauth/callback.tsx`).

- [ ] **Step 2: Typecheck**

Run: `cd packages/agents-mobile && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/agents-mobile/app/open-session.tsx
git commit -m "feat(agents-mobile): add open-session landing route"
```

---

### Task 11: Gate exemptions + re-entry in `_layout.tsx`

**Files:**

- Modify: `packages/agents-mobile/app/_layout.tsx`

- [ ] **Step 1: Read the pending link + matcher in `RootNavigator`**

In `RootNavigator`, extend the `useMobileAppState()` destructure to include `pendingSessionLink`, and add the import:

```ts
import { isSessionDeepLink } from '../src/lib/sessionLinks'
```

Destructure:

```ts
const {
  loading,
  serverUrl,
  launchUrl,
  onboardingDismissed,
  pendingSessionLink,
} = useMobileAppState()
```

- [ ] **Step 2: Add a cold-start redirect to the landing route**

After the existing `coldStartOAuthCallback` block, add:

```ts
  const coldStartSessionLink =
    !!launchUrl &&
    isSessionDeepLink(launchUrl) &&
    pathname !== `/open-session`

  if (coldStartSessionLink) {
    return <Redirect href="/open-session" />
  }
```

- [ ] **Step 3: Exempt `/open-session` from the onboarding and server-setup redirects**

In the onboarding redirect condition, add `pathname !== '/open-session'`:

```ts
  if (
    !onboardingDismissed &&
    pathname !== `/onboarding` &&
    pathname !== `/oauth/callback` &&
    pathname !== `/open-session`
  ) {
    return <Redirect href="/onboarding" />
  }
```

In the server-setup redirect condition, add `pathname !== '/open-session'`:

```ts
  if (
    !serverUrl &&
    pathname !== `/server-setup` &&
    pathname !== `/onboarding` &&
    pathname !== `/oauth/callback` &&
    pathname !== `/open-session`
  ) {
    return <Redirect href="/server-setup" />
  }
```

- [ ] **Step 4: Re-enter the landing route once gates clear**

Immediately after the server-setup redirect block (gates are clear here: onboarded + server set), add:

```ts
  // A deep link that arrived mid-onboarding (or while on another screen)
  // is consumed here once a server exists. `/open-session` clears the
  // pending link when it finishes routing, so this doesn't loop.
  if (pendingSessionLink && pathname !== `/open-session` && pathname !== `/session`) {
    return <Redirect href="/open-session" />
  }
```

- [ ] **Step 5: Typecheck**

Run: `cd packages/agents-mobile && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Manual smoke test (mobile dev)**

Run `cd packages/agents-mobile && pnpm start`, open the app in a simulator with a server configured and a known session. From a terminal:

- iOS: `xcrun simctl openurl booted "electric-agents://open-session?server=$(node -e 'process.stdout.write(encodeURIComponent("http://<host>"))')&entity=$(node -e 'process.stdout.write(encodeURIComponent("/<entityUrl>"))')"`
- Android: `adb shell am start -W -a android.intent.action.VIEW -d "electric-agents://open-session?server=…&entity=…"`
  Expected: app foregrounds and opens the session. Repeat with the app fully closed (cold start) and backgrounded (warm).

- [ ] **Step 7: Commit**

```bash
git add packages/agents-mobile/app/_layout.tsx
git commit -m "feat(agents-mobile): route open-session deep links through onboarding gates"
```

---

## Phase 4 — Generate links

### Task 12: Mobile share emits the app link

**Files:**

- Modify: `packages/agents-mobile/src/screens/ShareSessionScreen.tsx`

- [ ] **Step 1: Swap the link builder import**

In `packages/agents-mobile/src/screens/ShareSessionScreen.tsx`, change the import:

```ts
import { sessionAppUrl, sessionIdFromEntityUrl } from '../lib/sessionLinks'
```

(remove `sessionWebUrl` from that import.)

- [ ] **Step 2: Build the app link in `shareLink`**

In the `shareLink` callback, replace:

```ts
const url = sessionWebUrl(serverUrl, entityUrl)
```

with:

```ts
const url = sessionAppUrl(serverUrl, entityUrl)
```

- [ ] **Step 3: Update the displayed link text**

Replace the link-row text expression:

```tsx
{
  sessionWebUrl(serverUrl, entityUrl).replace(/^https?:\/\//, ``)
}
```

with:

```tsx
{
  sessionAppUrl(serverUrl, entityUrl)
}
```

- [ ] **Step 4: Typecheck + run mobile tests**

Run: `cd packages/agents-mobile && pnpm typecheck && pnpm vitest run`
Expected: PASS. (`sessionWebUrl` may now be unused; if a lint/unused export check fails, leave the export in `sessionLinks.ts` — other call sites or future web links may use it — but remove the now-dead import from this file, which Step 1 already does.)

- [ ] **Step 5: Commit**

```bash
git add packages/agents-mobile/src/screens/ShareSessionScreen.tsx
git commit -m "feat(agents-mobile): share the app deep link instead of the web link"
```

---

### Task 13: Desktop share dialog "Copy session link"

**Files:**

- Modify: `packages/agents-server-ui/src/components/ShareEntityDialog.tsx`
- Modify: `packages/agents-server-ui/src/components/ShareEntityDialog.module.css`

- [ ] **Step 1: Add imports**

`ShareEntityDialog` already destructures `const { activeServer } = useServerConnection()` and computes `const baseUrl = activeServer?.url ?? ''`, and receives the session as the `entity: ElectricEntity` prop (so `entity.url` is the entity url). Add only these imports:

```ts
import { sessionAppUrl } from '../lib/sessionLinks'
import { showToast } from '../lib/toast'
```

- [ ] **Step 2: Add a copy handler**

Inside `ShareEntityDialog` (after `baseUrl` is defined), add:

```ts
const copySessionLink = async (): Promise<void> => {
  if (!baseUrl) return
  const link = sessionAppUrl(baseUrl, entity.url)
  try {
    await navigator.clipboard.writeText(link)
    showToast({ title: `Session link copied`, tone: `success` })
  } catch {
    showToast({ title: `Couldn't copy link`, tone: `danger` })
  }
}
```

- [ ] **Step 3: Add a button to the dialog header/top section**

In the dialog's JSX, add a button near the top of the share panel (match the existing button styling conventions in `ShareEntityDialog.module.css`; add a `linkButton` class if needed):

```tsx
<button
  type="button"
  className={styles.linkButton}
  onClick={() => void copySessionLink()}
>
  Copy session link
</button>
```

If a new class is needed, add to `ShareEntityDialog.module.css`:

```css
.linkButton {
  align-self: flex-start;
  font: inherit;
  padding: 6px 10px;
  border: 1px solid var(--border-1);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}
.linkButton:hover {
  background: var(--surface-hover);
}
```

> Use the CSS variable names already present in `ShareEntityDialog.module.css`; if they differ, match the file's existing tokens rather than introducing new ones.

- [ ] **Step 4: Typecheck**

Run: `cd packages/agents-server-ui && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agents-server-ui/src/components/ShareEntityDialog.tsx packages/agents-server-ui/src/components/ShareEntityDialog.module.css
git commit -m "feat(agents-server-ui): add Copy session link to the share dialog"
```

---

## Phase 5 — Docs

### Task 14: Document deep links

**Files:**

- Create: `website/docs/agents/usage/sharing-and-deep-links.md`

- [ ] **Step 1: Check the docs sidebar config**

Find where `website/docs/agents/usage/*` pages are registered in the VitePress sidebar (search the `website/` config, e.g. `grep -rn "usage/overview" website/.vitepress 2>/dev/null` or wherever the agents sidebar is defined). Note the file to update in Step 3.

- [ ] **Step 2: Write the page**

Create `website/docs/agents/usage/sharing-and-deep-links.md`:

```markdown
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
  of opening (desktop), or opens onboarding for setup (mobile). For now there is
  no web-browser fallback.
```

- [ ] **Step 3: Register the page in the sidebar**

Add the new page to the agents "usage" sidebar group identified in Step 1 (mirror an existing entry such as `defining-tools`), e.g.:

```js
{ text: 'Sharing and deep links', link: '/docs/agents/usage/sharing-and-deep-links' },
```

- [ ] **Step 4: Commit**

```bash
git add website/docs/agents/usage/sharing-and-deep-links.md website/.vitepress
git commit -m "docs(agents): document electric-agents:// deep links"
```

---

## Phase 6 — Changeset + verification

### Task 15: Add a changeset

**Files:**

- Create: `.changeset/agents-deep-links.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/agents-deep-links.md` (patch bumps, short message — repo convention):

```markdown
---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-mobile': patch
'@electric-ax/agents-server-ui': patch
---

Add `electric-agents://open-session` deep links to open a session directly in the desktop and mobile apps. Share screens now generate the app link.
```

> Confirm the package names against each `package.json` (`@electric-ax/agents-desktop`, `@electric-ax/agents-mobile`, `@electric-ax/agents-server-ui`) and drop any package that the repo's changeset config marks private/unversioned.

- [ ] **Step 2: Commit**

```bash
git add .changeset/agents-deep-links.md
git commit -m "chore: changeset for agents deep links"
```

---

### Task 16: Full verification pass

- [ ] **Step 1: Run all affected unit tests + typechecks**

```bash
cd packages/agents-mobile && pnpm typecheck && pnpm vitest run
cd ../agents-server-ui && pnpm typecheck && pnpm vitest run src/lib/sessionLinks.test.ts
cd ../agents-desktop && pnpm typecheck && node --test --experimental-strip-types src/shared/deep-link.test.ts
```

Expected: all PASS.

- [ ] **Step 2: Manual platform matrix**

Verify and record results in the PR for each combination (app **running / backgrounded / closed**) × platform:

- macOS (desktop): `open "electric-agents://open-session?server=…&entity=…"`
- Windows (desktop): run the link from Explorer/Run dialog against an installed build.
- iOS (mobile): `xcrun simctl openurl booted "electric-agents://open-session?…"`
- Android (mobile): `adb shell am start -a android.intent.action.VIEW -d "electric-agents://open-session?…"`
  For each: known server opens the session; unknown server shows the inform path; the share UIs (mobile Share, desktop Copy session link) produce a link that round-trips.

- [ ] **Step 3: Commit any fixes discovered during verification, then open the PR**

---

## Spec coverage check

- Link format + scheme reuse → Tasks 1–3 (helpers), used everywhere.
- Desktop register/receive/route → Tasks 4–8.
- `electron-builder` protocol declaration → Task 7.
- Mobile capture + landing route + gating → Tasks 9–11.
- Generate (mobile share, desktop copy) → Tasks 12–13.
- Docs → Task 14.
- Unknown-server "inform only" → Task 5/8 (desktop toast) + Task 10 (mobile inform path).
- Testing (unit + manual matrix) → Tasks 1–3, 16.
- Out-of-scope items (web links, browser fallback, auto-add unknown server, non-session entities) → intentionally not implemented.
