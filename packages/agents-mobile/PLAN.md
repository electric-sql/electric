# Electric Agents Mobile Plan

## Goal

Build a mobile Electric Agents client using Expo and React Native. The mobile app connects to an existing agents server by URL. It does not bundle or manage a local Horton runtime.

The app should feel like the existing Electric Agents desktop/web UI, but with a native mobile shell: mobile navigation, native toolbar controls, drawer/sidebar behavior, and one active view at a time.

## Product Decisions

- Use Expo for the mobile app.
- Bundle the reused web UI assets inside the mobile app.
- Use server URL only for v1; no auth flow yet.
- Do not expose working-directory controls on mobile for now.
- Do not support desktop-style tiling, split panes, tile drag/drop, or layout persistence.
- Reuse chat/session views through WebViews.
- Build mobile shell/navigation/sidebar/top toolbar with React Native native controls.

## Package Shape

Create a new workspace package:

```text
packages/agents-mobile
```

This package should contain the Expo app and should depend on a bundled embed build from `packages/agents-server-ui`.

The mobile package should own:

- Expo app config and native runtime.
- Server URL setup and persistence.
- Native session list / drawer.
- Native top toolbar.
- Native routing and back behavior.
- WebView container screens.
- Mobile settings.
- Theme coordination between native UI and embedded web views.

## High-Level Architecture

The mobile app is split into two layers.

### Native Shell

React Native owns the mobile app frame:

- Server setup screen.
- Session list screen.
- New session screen.
- Session detail screen.
- Native top toolbar.
- Native drawer/sidebar.
- Settings screen.
- View switching between chat and state explorer.

The native shell should subscribe to the agents server for entity/session metadata. We expect the existing Electric / TanStack DB client stack to work in Expo. If it does not, we should fix the incompatibility in Electric or TanStack DB rather than design around it prematurely.

### Bundled Web Views

The existing web UI should provide a small embedded app that renders individual view bodies without the desktop/web workspace shell.

The embedded WebView layer should own:

- Chat timeline.
- Chat composer.
- State explorer.
- Future entity-specific web views.

The WebView should not render:

- Sidebar.
- Workspace tiling.
- Split menus.
- Tile drag/drop.
- Layout persistence.
- Desktop runtime controls.
- Local API key setup for bundled Horton.
- Working-directory picker.

## Server UI Embed Build

Add a dedicated embedded entrypoint to `packages/agents-server-ui`, separate from the current full router app.

Possible files:

```text
packages/agents-server-ui/src/embed/main.tsx
packages/agents-server-ui/src/embed/App.tsx
packages/agents-server-ui/src/embed/embed.css
```

Add a build script such as:

```json
"build:mobile-embed": "vite build --mode mobile-embed"
```

The embed app should mount the existing providers and view bodies, but skip the full workspace shell.

It should reuse:

- `ThemeProvider`
- `ElectricAgentsProvider`
- `ChatView`
- `StateExplorerView`
- `EntityTimeline`
- `MessageInput`
- `StateExplorerPanel`
- existing markdown/tool-call rendering

It should avoid:

- `RouterProvider` for the full app
- `WorkspaceProvider`
- `Workspace`
- `TileContainer`
- `SplitContainer`
- `Sidebar`
- desktop IPC hooks

## Embed Boot Contract

The native shell injects the initial config into `window.__MOBILE_EMBED__`
**before** any embed script runs (using
`WebView.injectedJavaScriptBeforeContentLoaded`). The embed reads it
synchronously in `readEmbedConfig()` so the first paint already matches the
host. URL hash params (`#serverUrl=…&entityUrl=…&view=…&theme=…`) are
honoured as a fallback so `embed.html` can be opened in a normal browser
during development.

Supported views: `chat`, `state-explorer`.

## WebView Bridge

The native ⇄ embed protocol is a tiny, typed JSON envelope passed over the
WebView `postMessage` channel. Both sides share the schema in mirrored
files (`packages/agents-mobile/src/webview/bridge.ts` and
`packages/agents-server-ui/src/embed/bridge.ts`).

Native → embed (live updates after `ready`):

- `{ type: 'set-view', view: 'chat' | 'state-explorer' }`
- `{ type: 'set-entity', entityUrl: string }`
- `{ type: 'set-theme', theme: 'light' | 'dark' }`

Embed → native:

- `{ type: 'ready' }` — sent once the React tree mounts. The host queues
  all `set-*` messages until it sees this so nothing is lost between mount
  and first user interaction.
- `{ type: 'navigate', pathname: string }` — every router resolution
  (e.g. `useNavigate({ to: '/entity/$' })` from `EntityContextDrawer`) is
  forwarded so the native shell can decide whether to open a different
  session.
- `{ type: 'error', message: string }` — reserved for embed-side fatals.

Live `set-*` messages are how we change view, entity and theme **without
re-parsing the multi-MB bundle**. The WebView stays mounted (keyed only on
`embed.uri`) for the lifetime of the `SessionScreen`. Cross-screen
navigation (back to the list, opening a different session via the list)
unmounts the WebView and re-parses; that's accepted for v1.

## Native Screens

### Server Setup

The first-run flow asks for an agents server URL and validates it with:

```text
GET /_electric/health
```

Persist the selected server URL locally.

### Session List

Native list of entities from the active server.

Use the existing grouping and display ideas from the web sidebar, adapted for mobile:

- Recent sessions first.
- Status indicators.
- Pinned sessions later if useful.
- Search/filter later.

The list should not include split/open-to-side behavior.

### New Session

Native v1 screen for creating a new session.

It should:

- Load entity types from the server.
- Prefer the default `horton` agent when available.
- Let the user type an initial message.
- Spawn with server defaults.
- Not ask for a working directory.

After spawn, navigate to the new session screen.

### Session Detail

Native screen containing:

- Top toolbar with back/menu, title, status, and view switcher.
- WebView for selected entity view.

The default view is `chat`.

### Settings

Mobile settings should be intentionally small for v1:

- Active server URL.
- Theme.
- Diagnostics/version info.

Do not include desktop local runtime settings.

## Bundled Asset Strategy

The mobile app should bundle the embedded web build as static assets. The WebView loads the local HTML bundle, and that embedded app talks to the configured remote agents server.

This gives us:

- Predictable mobile/web embed version matching the app release.
- No dependency on every agents server hosting mobile-specific frontend assets.
- Offline availability of the UI shell even when the server is unreachable.

The server is still required for data, streams, spawning, and sending messages.

## Styling Direction

Match the existing app visually, then adapt for mobile ergonomics:

- Keep Electric Agents colors, typography, spacing, and message styling.
- Increase touch targets.
- Respect safe areas.
- Tune chat column width for phone screens.
- Prefer native toolbar/drawer transitions.
- Remove hover-only affordances in mobile paths.
- Make composer behavior robust with the mobile keyboard.

The embedded web views should get mobile-specific CSS, especially for:

- viewport height
- safe area padding
- keyboard overlap
- scroll-to-bottom behavior
- compact message spacing
- state explorer responsiveness

## Risks

### React Native Compatibility

We expect the Electric / TanStack DB client stack to work in Expo. If it does not, fix the underlying compatibility in Electric or TanStack DB.

Do not prematurely add a separate mobile-only server API just to avoid this unless there is a concrete blocker.

### WebView Keyboard And Scrolling

The chat composer and timeline need early testing on iOS and Android. WebView keyboard resizing, safe areas, and scroll anchoring are the highest-risk UX details.

### Bundle Wiring

Bundling Vite output into Expo needs a small build pipeline. Keep the embed build isolated from the full desktop/web build so mobile does not inherit workspace shell behavior.

## Implementation Phases

### Phase 1: Skeleton — DONE

- Create Expo package in `packages/agents-mobile`.
- Add `react-native-webview`.
- Add server URL setup and health check.
- Add local persistence for the active server.
- Add basic native navigation.
- Track Expo SDK 54 (React Native 0.81, React 19.1). Built-in pnpm-monorepo Metro support means no `metro.config.js` overrides are required — `html` is in the default `assetExts`, every workspace package is in `watchFolders`, and `unstable_enableSymlinks` is no longer needed. Run `pnpm dlx expo-doctor` from `packages/agents-mobile` to confirm.

### Phase 2: Server Data — DONE

- Reuse or extract Electric Agents client logic for entity and entity-type collections.
- Render a native session list.
- Render a native new-session flow without working-directory support.

### Phase 3: Embedded Chat — IN PROGRESS

- ✅ Added mobile-embed entrypoint at `packages/agents-server-ui/embed.html` + `src/embed/main.tsx`.
- ✅ Added `vite build --mode mobile-embed` using `vite-plugin-singlefile` so the entire SPA inlines into one HTML file.
- ✅ Added `scripts/emit-mobile-embed.mjs` which copies that HTML into `packages/agents-mobile/assets/embed.html` as a tracked static asset.
- ✅ Mobile WebView host (`embedSource.ts`) loads the asset via `expo-asset` so Metro doesn't inline a multi-MB string into the JS bundle.
- ✅ Embed disables zoom: `viewport` is `maximum-scale=1, user-scalable=no` and the override sheet floors `<input>`/`<textarea>` to 16px so iOS doesn't auto-zoom on focus.
- ✅ Embed override sheet (`EmbedApp.module.css`) collapses the desktop chat geometry on mobile — `EntityTimeline.content`, `MessageInput.root` and `MessageInput.composer` lose their 36–40px gutters and run edge-to-edge.
- ✅ Vite mobile-embed mode pins CSS-modules to `[name]_[local]_[hash:base64:5]` so the embed override selectors (`[class*='EntityTimeline'][class*='_content_']` etc.) keep matching the production hash output.
- ⏭ Validate streaming, sending, markdown, tool calls and reconnect behaviour end-to-end; trim heavy renderers (mermaid, shiki, katex, streamdown) so the bundle is not 13 MB.

### Phase 4: Native Mobile Shell — IN PROGRESS

- ✅ `Header` component mirrors the web `MainHeader` strip exactly: 44px row, page background, no border, 10px gutter, leading + title + actions slots, identical to `MainHeader.module.css`.
- ✅ `SessionListScreen` mirrors the web `Sidebar`: `MainHeader` strip, `New session` row in the same 22px-icon-column geometry, date-bucketed sections (`Today` / `Yesterday` / `Previous 7 days` …) using the same `bucketEntities` algorithm as the web, `SidebarFooter` with server picker / filter / settings.
- ✅ `SidebarRow` mirrors `SidebarRow.module.css`: 28px row, 22px status-dot column, ellipsed title, lowercase `--ds-text-3` type label, `--ds-accent-a3` selected halo, `--ds-bg-hover` press halo, 0.55 stopped opacity.
- ✅ `SidebarFooter` mirrors the web composition: `ServerPickerTile` (status dot + name + chevrons) on the left, ghost `FooterIconButton`s for filter and settings on the right. All three open `BottomSheet` menus.
- ✅ `BottomSheet` primitive renders an iOS-style sheet over the screen with sectioned `BottomSheetItem` rows (icon + label + check), used by the server / filter / settings menus.
- ✅ `useSidebarPrefs` mirrors the web `useSidebarView` store (group-by + hidden-types + hidden-statuses), persisted to AsyncStorage. The list applies the prefs the same way the web sidebar does.
- ✅ `useThemePreference` mirrors the web `useDarkMode` preference (`system` / `light` / `dark`), persisted to AsyncStorage and consumed by `ThemeProvider`.
- ✅ `SessionScreen` toolbar mirrors `EntityHeader`: `MainHeader`-styled strip with `‹ Sessions` back affordance, baseline-aligned title + monospace sessionId subtitle, status `Badge` (matching `BadgeTone`), and ghost `IconToggle`s for the `chat` / `state-explorer` view switch.
- ✅ `StatusBar` style flips with the resolved theme.
- ✅ Theme + serverUrl + entityUrl + view propagated to the WebView via `injectedJavaScriptBeforeContentLoaded` (sets `window.__MOBILE_EMBED__`).

### Phase 5: Additional Views & Bridge — DONE (foundations)

- ✅ Bridge protocol formalised in `bridge.ts` (mirrored on both sides) covering
  `ready`, `navigate`, `set-view`, `set-entity`, `set-theme`. Native posts
  `set-*` only after the embed has acknowledged `ready` so no message can be
  silently dropped during boot.
- ✅ State Explorer toggle and entity navigation now flow through the bridge.
  Switching view, jumping to a related entity, and toggling the theme all
  re-render in-place without re-parsing the multi-MB bundle.
- ✅ WebView wrapped in `KeyboardAvoidingView` (iOS `padding`) so the embed
  composer follows the keyboard; embed CSS uses `height: 100%` (not `100vh`)
  so it shrinks correctly.
- ✅ EntityHost is keyed on `entityUrl` so the chat input/scroll reset
  cleanly when the host swaps the active entity.
- ⏭ Pull-to-refresh / drag-to-dismiss on the entity list.

### Phase 6: Polish — IN PROGRESS

- ✅ Native screens consume the same color, spacing, radius and typography tokens
  as the web app, in both light and dark modes.
- ✅ `Screen` now uses `react-native-safe-area-context`'s `SafeAreaView`
  wrapped in a top-level `SafeAreaProvider`; insets work on both iOS notches
  and Android `edgeToEdgeEnabled`.
- ✅ Status bar handled via `expo-status-bar` (`style="light"|"dark"`),
  which co-operates with edge-to-edge translucent system bars.
- ✅ Crypto polyfill (`react-native-random-uuid`) hoisted to `index.ts`
  so it loads before any other module evaluates `crypto.randomUUID`.
- ⏭ Safe-area edge cases on landscape / tablet.
- ⏭ Diagnostics for server connectivity and WebView errors.
- ⏭ Mobile-focused tests where practical.

## Working with the mobile-embed bundle

The bundled embed is **opt-in** and ignored from git history because the current single-file build is ~13 MB. Generate it on demand from either side:

```sh
# from the workspace root
pnpm --filter @electric-ax/agents-server-ui build:mobile-embed

# or from the mobile package (same script, just convenient)
pnpm --filter @electric-ax/agents-mobile embed:build
```

The script overwrites `packages/agents-mobile/assets/embed.html` with the freshly built bundle. Metro picks it up on next reload because `embedSource.ts` resolves it via `expo-asset`. A small placeholder ships in the repo under the same path so a fresh checkout still resolves; do **not** commit the regenerated 13 MB file back.

## Verifying the foundation

```sh
pnpm --filter @electric-ax/agents-mobile typecheck
pnpm --filter @electric-ax/agents-mobile doctor       # = expo-doctor (17/17 must pass)
pnpm --filter @electric-ax/agents-server-ui typecheck
```

When changing the embed, also rebuild and re-run the embed in the simulator
to confirm `ready`/`set-*` traffic in the JS console:

```sh
pnpm --filter @electric-ax/agents-mobile embed:build
pnpm --filter @electric-ax/agents-mobile ios   # or android
```

## First Milestone

The first useful milestone is:

- User enters a server URL.
- App shows live sessions in a native list.
- User starts a default Horton session with an initial message.
- App navigates to a native session screen.
- Chat runs inside a bundled WebView.
- Messages stream and send correctly.

This proves the main architecture without investing in secondary views or polish too early.
