# @electric-ax/agents-server

## 0.2.9

### Patch Changes

- 28d127b: Electron desktop shell, tile-based workspace, and per-session
  working-directory picker.
  - `@electric-ax/agents-desktop`: new package — Electron app
    bundling a local Horton runtime, system-tray status, multi-
    window support, frameless windows with in-app title bars,
    native menus, About dialog, on-launch API key prompt
    (Anthropic / OpenAI / Brave), localhost agent-server discovery,
    and HMR via `vite-plugin-electron`.
  - `@electric-ax/agents-server`: entrypoint support for the local
    desktop runtime wiring.
  - `@electric-ax/agents-server-ui`: tile-based workspace (DnD,
    splits, persisted layouts, shareable URLs), redesigned new-
    session screen, refreshed dropdown chrome (`Combobox`
    primitive, sentence-case section headings, ServerPicker-style
    rows), sidebar filter & view menu with grouping by date /
    type / status / working dir, full Settings screen with
    General / Appearance / Local Runtime categories.
  - `@electric-ax/agents`: Horton accepts an optional
    `workingDirectory` spawn arg so each session can run against
    its own project root without restarting the runtime.
  - `@electric-ax/agents-runtime`: tool-pair preservation during
    compaction and matching tool-call events by id (bug fixes
    surfaced while building the desktop UI).
  - `@electric-sql/experimental`, `@electric-sql/react`: align test
    type configuration with DOM AbortSignal types used by the client.

- a3cee92: Remove the coder entity (coding-session). The `registerCodingSession`, `useCodingAgent`, `CodingSessionHandle`, and related types/tools (`spawn_coder`, `prompt_coder`) are no longer available. The `agent-session-protocol` dependency is also removed.
- Updated dependencies [f509387]
- Updated dependencies [28d127b]
- Updated dependencies [6399147]
- Updated dependencies [a3cee92]
- Updated dependencies [92a332e]
  - @electric-ax/agents-runtime@0.1.3
  - @electric-sql/client@1.5.17

## 0.2.8

## 0.2.7

### Patch Changes

- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
- Updated dependencies [1cb5020]
  - @electric-ax/agents-runtime@0.1.2
  - @electric-sql/client@1.5.16

## 0.2.6

### Patch Changes

- 1218851: Pull in the latest `@electric-ax/agents-server-ui` bundle: replaces the old editorial/control/workshop font-theme picker with a single dark-mode toggle in the sidebar footer, and rewires `styles.css` to the Electric Agents brand palette (warm-stone light + deep-night dark, with navy/teal accents). Preference persists to `localStorage` and falls back to `prefers-color-scheme`.

## 0.2.5

### Patch Changes

- 1b334eb: Expose shared-state StreamDB sources in the embedded agents server UI state explorer.
- e0b588f: Bump `@electric-ax/durable-streams-*-beta` dependencies to the latest published versions (`client@^0.3.1`, `state@^0.3.1`, `server@^0.3.2`).
- Updated dependencies [e0b588f]
  - @electric-ax/agents-runtime@0.1.1

## 0.2.4

### Patch Changes

- 89debcf: Pull in the latest `@electric-ax/agents-server-ui` bundle (3-tab coder spawn dialog, queued-prompt timeline rows, full nativeSessionId in the session header) and minor comment cleanup in the proxied-CORS path.
- 491ba04: Move tool implementations (bash, read, write, edit, fetch_url, web_search, schedules) from agents-server to agents package, removing duplicate code. Tools are now exported from `@electric-ax/agents`.
- Updated dependencies [4987694]
- Updated dependencies [89debcf]
  - @electric-ax/agents-runtime@0.1.0

## 0.2.3

### Patch Changes

- e311cf1: feat: ui improvements

## 0.2.2

### Patch Changes

- Updated dependencies [9024ec2]
  - @electric-ax/agents-runtime@0.0.4

## 0.2.1

### Patch Changes

- 50bbf06: fix: ensure public url of the server is used everywhere
- 842182d: fix: ensure CORS is set to \*
- 4e60832: fix: improve docker image size
- Updated dependencies [5ef535b]
- Updated dependencies [6d8be8b]
  - @electric-ax/agents-runtime@0.0.3

## 0.2.0

### Minor Changes

- 0589cbc: Add state explorer panel to entity view with real-time StreamDB state visualization, time-travel through events, and jump-to-bottom button on timelines

### Patch Changes

- e52563c: feat: allow secret setting for electric instance

## 0.1.1

### Patch Changes

- Updated dependencies [097f2c4]
  - @electric-ax/agents-runtime@0.0.2
