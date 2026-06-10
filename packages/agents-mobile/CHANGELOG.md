# @electric-ax/agents-mobile

## 0.0.13

### Patch Changes

- 3dbd075: Add session pinning to the mobile app: long-press a root session row (or any search result) to open a context sheet with the entity info (title, session id, type/status, subagents, runner, sandbox, spawned, last active) and a Pin/Unpin action; the in-session kebab menu also gets a Pin/Unpin item, mirroring the desktop tile menu. Pinned sessions surface in a Pinned section above the groups, persisted per-device in AsyncStorage — the mobile mirror of the web sidebar's pinning. Runner-param types in agents-server-ui's `entityRuntime` helpers are loosened to structural subsets so the mobile app can reuse them.
- 7892079: Per-runner recent working directories in the spawn UI, derived from the synced sessions list so the same recents appear on every device. The desktop picker becomes per-runner (replacing the localStorage list), and mobile gains sandbox-profile and working-directory selection — including sending the sandbox profile on spawn, without which the runtime ignores the chosen directory.
- Updated dependencies [3dbd075]
- Updated dependencies [d15852d]
- Updated dependencies [5aa2d78]
- Updated dependencies [5aa2d78]
- Updated dependencies [146f238]
- Updated dependencies [7892079]
- Updated dependencies [1099366]
- Updated dependencies [1099366]
  - @electric-ax/agents-server-ui@0.4.18
  - @electric-ax/agents-runtime@0.3.11

## 0.0.12

### Patch Changes

- Updated dependencies [3ecdade]
  - @electric-ax/agents-runtime@0.3.10
  - @electric-ax/agents-server-ui@0.4.17

## 0.0.11

### Patch Changes

- a811960: Add Sentry crash/error reporting to the mobile app: errors-only reporting disabled in development, with source-map upload wired through the `withSentry` Expo config plugin and `getSentryExpoConfig` metro wrapper.
- 4f88e6d: Dedupe `@tanstack/db` to a single instance.

  `@tanstack/db` is effectively a singleton (collections/transactions/live
  queries use `instanceof` checks and module-level state), but the lockfile had
  drifted to several `0.6.x` copies, breaking StreamDB collections. Adds a root
  `pnpm.overrides` entry collapsing the `0.6.x` line to `0.6.7`, scoped to
  `>=0.6.0 <0.7.0` so the legacy example starters pinned to `0.0.x`/`0.5.8` are
  untouched. Stopgap until `@durable-streams/state` ships `@tanstack/db` as a
  peer dependency.

  Also raises the `agents-mobile` iOS minimum deployment target to 16.4 (via
  `expo-build-properties`). The chat renders in an Expo DOM WebView whose markdown
  stack ships regex lookbehind, which JavaScriptCore only parses on iOS 16.4+;
  below that the whole DOM bundle fails to parse and the chat renders blank.

- b2bf806: Upgrade `@durable-streams/state` to `0.3.1` and drop the `@tanstack/db` pnpm override.

  `@durable-streams/state@0.3.x` makes `@tanstack/db` an optional peer dependency (it was a direct `^0.6.0` dependency) and splits its tsdb-coupled tools into a `@durable-streams/state/db` subpath. tsdb-specific imports (`createStreamDB`, `queryOnce`, `createTransaction`, query operators, etc.) now come from `@durable-streams/state/db`; the bare entry keeps only the tsdb-free types and helpers.

  Because state no longer pulls its own `@tanstack/db` copy, the root `pnpm.overrides` collapsing `@tanstack/db@>=0.6.0 <0.7.0` to `0.6.7` is removed. To keep a single `0.6.7` instance without it, `@tanstack/react-db` is raised to `^0.1.85` and `@tanstack/electric-db-collection` to `^0.3.5` (both pin `@tanstack/db@0.6.7`), and `@durable-streams/server` to `^0.3.7` (depends on `state@0.3.1`, removing the lingering transitive `state@0.2.9`).

- 3fb4461: Harden the mobile kebab-menu server picker: surface connect failures in-sheet instead of silently swallowing them, persist a Cloud server only after the switch succeeds, and let the submenu close animation finish before resetting to the root page.
- 889fa20: Expose tenant-scoped users as an Electric shape and add a chat sharing dialog that grants user principals or all workspace users view, chat, or manage permissions over an entity. View/chat sharing includes fork access, forked chats are owned by the principal that creates the fork, shared chats can be identified and filtered by creator in the sidebar, and Cloud requests now inject the signed-in user as the Electric principal.

  Mobile now syncs the users and effective-permissions shapes, marks and filters shared chats by creator, disables native chat and signal controls when the current principal lacks permission, and shows the signed-in user principal on the Account screen for debugging.

- Updated dependencies [9fdf96a]
- Updated dependencies [f222d39]
- Updated dependencies [312f5ec]
- Updated dependencies [6434774]
- Updated dependencies [312f5ec]
- Updated dependencies [4f88e6d]
- Updated dependencies [b2bf806]
- Updated dependencies [6e9e4a7]
- Updated dependencies [74d2341]
- Updated dependencies [d14d9a9]
- Updated dependencies [7c62024]
- Updated dependencies [889fa20]
  - @electric-ax/agents-runtime@0.3.9
  - @electric-ax/agents-server-ui@0.4.16

## 0.0.10

### Patch Changes

- Updated dependencies [17b374f]
- Updated dependencies [f73d64a]
- Updated dependencies [1a7d72e]
- Updated dependencies [d5708c7]
- Updated dependencies [d5708c7]
- Updated dependencies [4e2cc22]
- Updated dependencies [2896820]
- Updated dependencies [f2d3d5e]
  - @electric-ax/agents-runtime@0.3.8
  - @electric-ax/agents-server-ui@0.4.15

## 0.0.9

### Patch Changes

- Updated dependencies [7d029a9]
- Updated dependencies [9e01e58]
  - @electric-ax/agents-server-ui@0.4.14
  - @electric-ax/agents-runtime@0.3.7

## 0.0.8

### Patch Changes

- acad656: Add an in-app "Delete account" button to the Account screen (visible
  when signed in to Electric Cloud). Tapping the button opens the
  account-deletion instructions page at
  https://electric-sql.com/about/legal/delete-account in the system
  browser. Required for Google Play submission.
- 1c6ebf9: Bump `expo` to `54.0.35` and `expo-router` to `~6.0.24` to match the
  patch versions expo-doctor expects (so the `Agents Mobile PR` CI
  check stops failing on `expo-doctor`'s "packages match versions
  required by installed Expo SDK" check).
- b2ddd59: Redesign mobile onboarding to mirror the desktop wizard and make it
  mandatory until a server connection is saved.
  - Two-step wizard (Cloud sign-in → Server selection) sharing the desktop
    wizard's visual anatomy — step indicator, step header, section cards,
    pinned footer respecting safe-area insets. Mobile has no local Horton
    runtime so the "model providers" step is omitted.
  - Cloud server picker rows commit the connection on tap via a new
    `onConnect(url)` callback, fixing the bug where tapping a cloud row
    populated the URL input instead of connecting. Manual self-hosted URL
    entry lives in a collapsible "Custom server" section with inline error
    display.
  - Onboarding is now mandatory until `onComplete` saves a URL — the
    "Don't show this again" and "Skip for now" escape valves are removed.
    Invariant: `onboardingDismissed=true ⟹ serverUrl is set`.
  - `ServerSetupScreen` is rewritten on top of the step-2 anatomy so the
    Settings → Server screen and the onboarding server step stay aligned.
  - Cloud → server auto-advance is a one-shot per sign-in transition,
    seeded from `startStep` so warm restarts with a restored session
    don't silently re-advance when the user taps Back.
  - `DiagnosticsScreen` gains a `__DEV__`-gated **Clear all local data**
    action that wipes AsyncStorage, signs out of Cloud, and reloads the
    JS bundle into a fresh onboarding flow. Copy mirrors the desktop
    Settings → General → Reset wording.

- cf27b10: Align the mobile sessions overview with the desktop sidebar by hiding
  principal entities and using the same lifecycle ordering for status
  groups.
- 1331cf6: Prevent the mobile session screen from flashing white while the embedded stream WebView boots by applying the themed background to all native DOM/WebView layers.
- Updated dependencies [e9ea591]
- Updated dependencies [86643d5]
- Updated dependencies [0a15a47]
- Updated dependencies [d921a9f]
- Updated dependencies [98b51d6]
- Updated dependencies [aed2189]
- Updated dependencies [52a641f]
- Updated dependencies [c89aac8]
- Updated dependencies [7001f8f]
  - @electric-ax/agents-runtime@0.3.6
  - @electric-ax/agents-server-ui@0.4.13

## 0.0.7

### Patch Changes

- Updated dependencies [0ba0a43]
  - @electric-ax/agents-server-ui@0.4.12

## 0.0.6

### Patch Changes

- 3a7cafd: Fix Android Electric Cloud sign-in flow getting stuck after Google / GitHub auth.

  The Chrome Custom Tab redirect (`electric-agents://oauth/callback?...`)
  was being lost on real Android devices (especially Android 13+ release
  builds), so the sign-in never completed and the user was bounced back
  to the welcome screen. Multiple layers had to be hardened:
  - **Config plugin** that injects an `onNewIntent` override into the
    generated `MainActivity.kt` so new intents (delivered when Android
    kills our process while the browser is open and then relaunches
    via the redirect) are forwarded to `getIntent()` for
    `expo-linking` / `expo-web-browser` to pick up. Mitigates
    [expo/expo#44284](https://github.com/expo/expo/issues/44284). The
    plugin imports `expo/config-plugins` (not `@expo/config-plugins`)
    because pnpm doesn't hoist the latter into the package's
    `node_modules`, which broke `expo cli config --json` inside EAS
    Build.
  - The OAuth deep link is consumed by a **global listener mounted in
    `CloudAuthProvider`** (in addition to the `/oauth/callback`
    route), so cold-start redirects are completed even before Expo
    Router has had a chance to navigate to the route.
  - `parseCallbackUrl` uses `expo-linking`'s `Linking.parse` rather
    than `new URL()`, which is unreliable for custom schemes in
    Hermes release builds.
  - `signIn` waits a few seconds for the deep link to arrive when the
    browser session returns `dismiss`, instead of immediately
    rolling state back to `signed-out`.
  - `completeCallbackUrl` is idempotent so the three concurrent
    handlers (browser-session result, global Linking listener,
    `/oauth/callback` route) can't trample each other.
  - The `/oauth/callback` route subscribes to cloud-auth state and
    navigates with `<Redirect>` (rendered during the render phase)
    instead of `router.replace` inside an effect — the effect-based
    version raced with Expo Router's own intent handling in dev
    builds, leaving the route stuck on the spinner even though
    sign-in had succeeded. The redirect destination also takes the
    user's onboarding / server state into account so a first-time
    signer-in goes back to `/onboarding` to finish the wizard
    instead of being bounced through `/` (where `SessionListScreen`
    would crash on `useAgents` because `AgentsProvider` isn't
    mounted yet).
  - Routes that call `useAgents()` (`/`, `/session`, `/new-session`,
    `/diagnostics`) now go through a `useAgentsRouteGuard` helper
    that emits a `<Redirect>` to `/onboarding` / `/server-setup` when
    the user hasn't finished setup yet, so transient mounts during
    redirect chains can't render those screens before the root
    layout's own redirects catch up.

- d344c32: Treat Electric Agents server URLs as opaque tenant-scoped base URLs rooted at `/t/<tenant-id>/v1`, migrate desktop and mobile Cloud clients to that URL shape, move observation stream ensure endpoints under `/_electric/observations/*/ensure-stream`, rename the pre-alpha entity/cron/schema/tag/docs APIs to their Electric Agents names, add a non-interactive `electric agents view` transcript command, and make Horton title extraction work with lightweight desktop inbox collection facades.

  Send the done callback for completed wake checkpoints during graceful shutdown, preventing desktop reloads from leaving already completed DS subscription claims pending.

- c1834f3: Prepare the mobile app for Expo EAS builds and CI. Adds dynamic Expo config, EAS build profiles, mobile CI/export scripts, and aligns shared React/TypeScript dependency resolution so the Expo DOM embed typechecks and passes `expo-doctor`.
- Updated dependencies [d344c32]
- Updated dependencies [c1834f3]
- Updated dependencies [319e405]
  - @electric-ax/agents-runtime@0.3.5
  - @electric-ax/agents-server-ui@0.4.11

## 0.0.5

### Patch Changes

- Updated dependencies [ac21b9a]
  - @electric-ax/agents-server-ui@0.4.10

## 0.0.4

### Patch Changes

- Updated dependencies [833a1cb]
- Updated dependencies [833a1cb]
  - @electric-ax/agents-runtime@0.3.4
  - @electric-ax/agents-server-ui@0.4.9

## 0.0.3

### Patch Changes

- d7506a2: Add mobile agent signal controls. The mobile chat composer now shows a stop control while a run is active, the session menu exposes all entity signal types in a child menu, and the embedded chat timeline accounts for the native composer/drawer inset with aligned message widths and bottom fade masking.
- Updated dependencies [b39f581]
- Updated dependencies [9c2c3ae]
- Updated dependencies [a70567e]
- Updated dependencies [b3d4f02]
- Updated dependencies [d7506a2]
- Updated dependencies [dffbf62]
- Updated dependencies [86e69d5]
  - @electric-ax/agents-server-ui@0.4.8
  - @electric-ax/agents-runtime@0.3.3

## 0.0.2

### Patch Changes

- 4d9c36e: Add a fine-grained reactive entity timeline query and migrate the agents UI to use it. Timeline rows are maintained by TanStack DB using multi-source queries and live child collections, so streamed agent responses update incrementally without rematerializing the whole chat timeline. Update the mobile app to consume the row-based timeline shape and pin React to the React Native renderer version. Keep the conformance property-test model aligned with generated entity type names.
- Updated dependencies [e13cad1]
- Updated dependencies [da26799]
- Updated dependencies [4d9c36e]
  - @electric-ax/agents-runtime@0.3.2
  - @electric-ax/agents-server-ui@0.4.7

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
