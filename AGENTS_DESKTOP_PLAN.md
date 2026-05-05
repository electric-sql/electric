# Agents Desktop Plan

## Goal

Build a desktop app package at `packages/agents-desktop` that reuses the existing
`packages/agents-server-ui` React app while adding local desktop functionality.

The first version should not bundle an Agents server, Postgres, or Electric. It
should bundle and manage the local builtin agents runtime from `@electric-ax/agents`
so Horton and related background agents can run locally while connecting to an
external Agents server.

## Product Shape

The desktop app is both:

- A desktop windowed version of the Agents UI.
- A background local agents runtime indicator/controller.

On macOS this should include a menu bar icon next to the clock. On Windows and
Linux the equivalent should be a tray/status area icon.

The tray/menu bar app should make it clear that the local agents runtime is
running even when all UI windows are closed. This matters because a CLI version
of the interface may also use the same background runtime for agents.

The app should support multiple windows. Closing the last window should not
necessarily stop the local runtime; quitting the app explicitly should.

## Version 1 Scope

In scope:

- Create `packages/agents-desktop`.
- Package the shared `agents-server-ui` renderer inside Electron.
- Start and stop a local `BuiltinAgentsServer` from `@electric-ax/agents`.
- Register Horton and worker agent types with the selected external Agents server.
- Persist desktop settings using Electron-side storage rather than only browser
  `localStorage`.
- Show runtime status in both the app UI and tray/menu bar.
- Support multiple app windows.
- Allow the app to continue running in the background after windows are closed.

Out of scope for v1:

- Bundling `@electric-ax/agents-server`.
- Bundling or managing Postgres.
- Bundling or managing Electric.
- Solving remote callback tunnelling for non-local Agents servers.
- Full auto-update/signing/release polish, unless needed for internal testing.

## Important Constraint

The selected Agents server must be able to call the local builtin agents runtime
webhook.

For local development, this is straightforward:

```text
Desktop app starts BuiltinAgentsServer on 127.0.0.1:<port>
Agents UI connects to http://127.0.0.1:4437
Agents server calls back to http://127.0.0.1:<port>/_electric/builtin-agent-handler
```

For a remote Agents server, `127.0.0.1` would refer to the remote machine, not
the user's desktop. Remote support needs a later tunnel/relay/public callback
design. V1 should clearly communicate that the connected Agents server must be
able to reach the local runtime URL.

## Package Structure

Proposed package:

```text
packages/agents-desktop/
  package.json
  tsconfig.json
  vite.config.ts
  electron/
    main.ts
    preload.ts
  src/
    renderer-entry.tsx, if needed
  assets/
    tray icons
```

The package should depend on:

- `@electric-ax/agents-server-ui`
- `@electric-ax/agents`
- `electron`
- an Electron packaging/build tool

The exact packaging tool can be chosen during implementation. Prefer the
simplest setup that works cleanly in the pnpm monorepo and supports macOS first,
with a path to Windows/Linux packaging.

## Renderer Strategy

Keep `packages/agents-server-ui` as the single shared renderer implementation.

The web server build currently uses:

```ts
base: `/__agent_ui/`
```

Electron should use a renderer build with a file-friendly asset base, likely:

```ts
base: `./`
```

Implementation options:

1. Add an environment-controlled base to `agents-server-ui/vite.config.ts`.
2. Add a second build command in `agents-server-ui`, for example
   `build:desktop`.
3. Let `agents-desktop` invoke or reference that desktop build.

Prefer keeping the app code shared and changing only the build base.

## Electron Main Process

The Electron main process should own:

- app lifecycle
- tray/menu bar icon
- window creation
- multi-window tracking
- local builtin agents runtime lifecycle
- desktop settings persistence
- IPC handlers exposed through preload

Runtime startup should use the existing exported API:

```ts
import { BuiltinAgentsServer } from '@electric-ax/agents'

const runtime = new BuiltinAgentsServer({
  agentServerUrl,
  host: `127.0.0.1`,
  port: 0,
  workingDirectory,
})

await runtime.start()
```

Use `port: 0` so the OS selects a free port. The returned URL can be shown in
debug/status UI and used for health checks.

When the active Agents server changes, the desktop app should stop the current
runtime and start a new one registered against the new `agentServerUrl`.

## Tray/Menu Bar Behavior

The tray/menu bar icon should indicate the runtime state:

- Starting
- Running
- Error
- Stopped

Suggested menu items:

- Open Agents
- New Window
- Runtime status
- Connected server
- Restart local runtime
- Stop local runtime
- Settings
- Quit

On macOS:

- Closing a window should close that window but keep the app and runtime alive.
- Cmd+Q or the tray Quit action should stop the runtime and quit the app.
- Clicking the dock icon should reopen or create a window.

On Windows/Linux:

- Closing the last window should minimize-to-tray behavior unless the user chose
  Quit.
- Tray Quit should stop the runtime and exit.

## Multiple Windows

The desktop app should support multiple independent renderer windows.

Each window can load the same renderer build and share the same Electron main
process state:

- saved server list
- active server
- runtime status
- working directory
- API key availability/status

The active server should probably be global for v1 because there is one local
builtin agents runtime process. Per-window active servers would imply multiple
runtime registrations and more complex lifecycle semantics.

## Preload API

Extend the existing `window.electronAPI` shape rather than exposing Node APIs to
the renderer.

Initial API:

```ts
window.electronAPI = {
  getServers(): Promise<Array<ServerConfig>>
  saveServers(servers: Array<ServerConfig>): Promise<void>

  getDesktopState(): Promise<DesktopState>
  setActiveServer(server: ServerConfig | null): Promise<void>
  restartRuntime(): Promise<void>
  stopRuntime(): Promise<void>

  getWorkingDirectory(): Promise<string | null>
  chooseWorkingDirectory(): Promise<string | null>

  onDesktopStateChanged(callback: (state: DesktopState) => void): () => void
}
```

Example state:

```ts
type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

interface DesktopState {
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
}
```

The renderer should use this for desktop-only behavior while continuing to work
in a normal browser without `window.electronAPI`.

## UI Changes

Keep UI changes modest:

- Show a local runtime status surface near the existing server picker or settings
  menu.
- Distinguish between "connected to Agents server" and "local Horton runtime is
  registered/running".
- If the runtime fails because no model provider key is configured, show a clear
  message for `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`.
- If the selected server is remote, warn that the server may not be able to call
  back to the local runtime unless a public callback URL is configured.

## Configuration

Desktop settings should include:

- saved Agents servers
- active Agents server
- working directory
- start runtime on launch
- keep running after windows close
- optional public callback/base URL override

API keys need a product decision:

- For v1 internal/dev use, reading from environment may be sufficient.
- For packaged app users, store credentials in the OS keychain or equivalent.

Do not store model provider API keys in plaintext JSON settings.

## Development Workflow

Suggested scripts:

```json
{
  "dev": "run Electron with Vite renderer",
  "build": "build renderer, main, and preload",
  "package": "create unpacked app",
  "dist": "create distributable app"
}
```

During development, the Electron app can load the Vite dev server. In packaged
builds, it should load the built renderer from disk.

The external Agents server still needs to be started separately, for example:

```sh
DATABASE_URL=postgresql://... \
ELECTRIC_AGENTS_ELECTRIC_URL=http://localhost:3060 \
ELECTRIC_INSECURE=true \
node packages/agents-server/dist/entrypoint.js
```

Then the desktop app connects to that server and starts its local builtin agents
runtime against it.

## Implementation Phases

### Phase 1: Package Skeleton

- Add `packages/agents-desktop`.
- Add Electron main/preload TypeScript build.
- Add a basic window loading the shared UI.
- Add macOS tray/menu bar icon with Open, New Window, and Quit.

### Phase 2: Shared Renderer Build

- Add a desktop renderer build path for `agents-server-ui`.
- Ensure hash routing and static assets work from Electron's file URL.
- Keep the web `/__agent_ui/` build unchanged.

### Phase 3: Settings and IPC

- Move saved server persistence through Electron for desktop.
- Add desktop state IPC.
- Keep browser fallback behavior intact.

### Phase 4: Builtin Runtime Lifecycle

- Start `BuiltinAgentsServer` when an active server is selected.
- Restart it when the active server changes.
- Stop it on explicit app quit.
- Surface status and errors in tray/menu bar and UI.

### Phase 5: Multi-Window Polish

- Add New Window support.
- Share desktop state updates across windows.
- Decide and implement close/minimize-to-tray behavior per platform.

### Phase 6: Local Runtime UX

- Add runtime status component to the UI.
- Add restart/stop actions.
- Add missing-key and unreachable-server guidance.
- Add optional working directory picker.

### Phase 7: Packaging

- Produce a macOS build for internal testing.
- Add icons and app metadata.
- Document Windows/Linux packaging gaps and test the tray behavior there.

## Open Questions

- Should the desktop app own the active server globally, or should each window be
  able to choose independently? V1 should probably keep it global.
- Should the runtime start immediately on launch or only after the first window
  chooses a server?
- Where should working directory default to: app data, user's home directory, or
  the last selected project directory?
- How should packaged users configure `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`?
- Is remote Agents server support required before public release, or can v1
  explicitly target local Agents servers?
- Should the CLI and desktop app coordinate over a shared local runtime lock/API?

## Success Criteria

- The Electron app opens the existing Agents UI.
- Multiple windows can be opened.
- The tray/menu bar icon remains present after all windows are closed.
- The local builtin agents runtime starts and registers Horton with the selected
  Agents server.
- The UI can start a Horton session through the external Agents server.
- Quitting the app cleanly stops the local runtime.
