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

## Embed Route Contract

The bundled web app can expose a minimal route/query contract.

Example:

```text
embed.html?serverUrl=https%3A%2F%2Fagents.example.com&entityUrl=%2Fhorton%2Fabc123&view=chat&theme=dark
```

Supported views for v1:

- `chat`
- `state-explorer`

The mobile app can start with query params only. Add `postMessage` later for richer bidirectional coordination.

## WebView Bridge

Start minimal and expand when needed.

Native to WebView:

- `serverUrl`
- `entityUrl`
- `view`
- `theme`

WebView to native:

- `ready`
- `error`
- `navigateToEntity`
- `spawnedEntity`
- `entityStatusChanged`
- `titleChanged`
- `openExternalUrl`

The bridge should be versioned once it grows beyond the initial query-param contract.

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

### Phase 1: Skeleton

- Create Expo package in `packages/agents-mobile`.
- Add `react-native-webview`.
- Add server URL setup and health check.
- Add local persistence for the active server.
- Add basic native navigation.

### Phase 2: Server Data

- Reuse or extract Electric Agents client logic for entity and entity-type collections.
- Render a native session list.
- Render a native new-session flow without working-directory support.

### Phase 3: Embedded Chat

- Add mobile embed entrypoint to `agents-server-ui`.
- Build and bundle embed assets into the Expo app.
- Load chat view in a WebView for the active entity.
- Validate streaming, sending, markdown, tool calls, and reconnect behavior.

### Phase 4: Native Mobile Shell

- Add native top toolbar.
- Add native drawer/sidebar behavior.
- Add view switcher.
- Add theme propagation to WebView.
- Add native back behavior.

### Phase 5: Additional Views

- Add state explorer WebView.
- Add any other existing entity views that make sense on mobile.
- Improve responsive behavior inside embedded views.

### Phase 6: Polish

- Tune mobile spacing and typography.
- Handle safe areas and keyboard edge cases.
- Add loading/error/empty states.
- Add diagnostics for server connectivity and WebView errors.
- Add mobile-focused tests where practical.

## First Milestone

The first useful milestone is:

- User enters a server URL.
- App shows live sessions in a native list.
- User starts a default Horton session with an initial message.
- App navigates to a native session screen.
- Chat runs inside a bundled WebView.
- Messages stream and send correctly.

This proves the main architecture without investing in secondary views or polish too early.
