# Electric CLI Desktop Bundle Plan

## Goal

Bundle the Electric CLI from `packages/electric-ax` with
`packages/agents-desktop` so users can install an `electric` command from the
desktop app. The installed command should track desktop app updates, while still
respecting users who install and manage the CLI themselves.

The target experience:

- first-run onboarding offers to install the CLI from the existing Config step
- Settings shows whether the CLI is installed, how it is managed, and where it
  resolves from
- desktop-managed installs update when the desktop app updates
- manually installed CLIs are detected and left alone
- uninstall/repair actions only touch shims that are clearly owned by Electric
  Agents Desktop

## Current State

`packages/electric-ax` already defines CLI binaries:

- `electric`
- `electric-ax`
- `electric-dev`

The main CLI entrypoint is `packages/electric-ax/src/index.ts`, built by
`tsdown` into `dist/index.js` and `dist/index.cjs`.

`packages/agents-desktop` currently packages:

- the Electron main/preload bundle from `dist`
- the renderer from `packages/agents-server-ui/dist-desktop`
- desktop assets
- bundled agent skills

It does not currently package `electric-ax`, expose CLI management IPC, or show
CLI status in onboarding/settings.

The desktop onboarding modal already has a Config step in
`packages/agents-server-ui/src/components/OnboardingModal.tsx`. That is the
right place to offer CLI installation alongside "Open at login".

Settings already follows a clean pattern:

- main-process domain service
- IPC module in `packages/agents-desktop/src/ipc`
- preload bridge in `packages/agents-desktop/src/preload.ts`
- renderer wrapper in `packages/agents-server-ui/src/lib/server-connection.ts`
- settings UI under `packages/agents-server-ui/src/components/settings`

## Core Approach

Build a dedicated CLI artifact as part of the desktop package, but keep it as a
separate runtime entrypoint from the Electron main process.

Use Electron's bundled Node runtime to execute it:

```sh
ELECTRON_RUN_AS_NODE=1 "/Applications/Electric Agents.app/Contents/MacOS/Electric Agents" \
  "/Applications/Electric Agents.app/Contents/Resources/cli/electric-ax/index.js" "$@"
```

This gives us three useful properties:

- the desktop app owns the Node runtime used by the managed CLI
- desktop updates update both the CLI code and runtime
- the global command can be a small, inspectable shim rather than a copied CLI

Do not reuse `packages/agents-desktop/dist/main.cjs` as the CLI entrypoint. The
desktop main bundle is optimized for Electron app startup and app lifecycle,
while the CLI has different `argv`, TTY, completion, dynamic import, and error
handling requirements. The CLI should share source packages at build time, not
desktop main-process internals at runtime.

## Packaging Plan

Add a desktop-specific CLI build target for `packages/electric-ax`.

Requirements:

- produces a stable CLI entrypoint for `electric`
- works when run with `ELECTRON_RUN_AS_NODE=1`
- includes or can resolve all runtime dependencies from inside the packaged app
- does not depend on project workspace layout
- preserves CLI behavior for TTY commands, completions, and dynamic imports

Preferred output:

```text
packages/agents-desktop/
  dist-cli/
    electric-ax/
      index.js
      package.json
      ...
```

Then include it in `packages/agents-desktop/electron-builder.yml`:

```yaml
extraResources:
  - from: dist-cli/electric-ax
    to: cli/electric-ax
    filter:
      - '**/*'
```

Open implementation choice:

- A self-contained single-file or small multi-file bundle is preferable.
- If external dependencies remain, package the required `node_modules` subset
  alongside the CLI under `Resources/cli/electric-ax`.

## Shim Model

The desktop app installs a managed shim named `electric`.

On macOS/Linux, the shim should be a shell script:

```sh
#!/bin/sh
# Managed by Electric Agents Desktop
# electric-agents-cli-shim-version: 1
# electric-agents-cli-command: electric

export ELECTRON_RUN_AS_NODE=1
exec "/path/to/Electric Agents executable" "/path/to/Resources/cli/electric-ax/index.js" "$@"
```

On Windows, install a `.cmd` shim with equivalent behavior:

```bat
@echo off
set ELECTRON_RUN_AS_NODE=1
"C:\Path\To\Electric Agents.exe" "C:\Path\To\resources\cli\electric-ax\index.js" %*
```

The shim should include enough marker metadata for safe detection and uninstall.
Uninstall must refuse to remove a file that is not clearly a desktop-managed
shim.

## Install Location

Default to a user-writable install directory.

Recommended priority:

1. `$HOME/.local/bin`
2. `$HOME/bin`
3. a platform-specific app-managed bin directory if neither user bin exists
4. `/usr/local/bin` only when writable and explicitly chosen

The app should detect whether the chosen directory is on `PATH`. If not, show a
clear warning and the shell line the user needs to add.

Avoid silently requiring elevated permissions. Global system paths can be a
future enhancement.

## CLI Detection

The desktop app should detect both managed and self-managed installs.

Detection inputs:

- all `electric` matches on `PATH`, not just the first one
- the first command that would run in the user's shell
- whether any match is a desktop-managed shim
- resolved version of the installed command
- bundled CLI version
- whether the managed shim points at the current app bundle
- whether another command shadows the managed shim
- whether the install directory is on `PATH`

Suggested status model:

```ts
export type ElectricCliInstallKind =
  | `not-installed`
  | `managed`
  | `manual`
  | `shadowed`
  | `broken`

export type ElectricCliStatus = {
  kind: ElectricCliInstallKind
  command: `electric`
  path: string | null
  version: string | null
  bundledVersion: string
  managedPath: string | null
  installDir: string
  installDirOnPath: boolean
  error: string | null
}
```

Meaning:

- `not-installed`: no usable `electric` found
- `managed`: the first `electric` on `PATH` is the current desktop-managed shim
- `manual`: the first `electric` on `PATH` exists but is not managed by desktop
- `shadowed`: desktop-managed shim exists, but another `electric` comes first
- `broken`: a managed shim exists but points to a missing app/CLI or fails

## Version And Doctor Support

`electric-ax` should expose a reliable version/status command.

Minimum:

```sh
electric --version
```

Better:

```sh
electric doctor --json
```

or:

```sh
electric agents doctor --json
```

Machine-readable output should include:

- CLI version
- executable path if available
- Node/Electron runtime version
- default agents server URL
- whether it is running under Electron's Node mode

This makes Settings more reliable and avoids brittle parsing of human output.

## Main-Process Service

Add a focused desktop CLI service:

```text
packages/agents-desktop/src/cli/
  controller.ts
  detection.ts
  shims.ts
  paths.ts
```

Responsibilities:

- calculate packaged and dev CLI resource paths
- calculate the Electron executable path
- inspect `PATH`
- read and validate managed shim markers
- install/repair the managed shim
- uninstall only managed shims
- run CLI version/doctor checks with timeouts

The service should be owned by `DesktopAppContext` or wired into
`createDesktopMainController`, matching existing desktop services.

## IPC Plan

Add `packages/agents-desktop/src/ipc/cli.ts`:

```ts
ipcMain.handle(`desktop:get-cli-status`, () => deps.getCliStatus())
ipcMain.handle(`desktop:install-cli`, () => deps.installCli())
ipcMain.handle(`desktop:uninstall-cli`, () => deps.uninstallCli())
```

Wire it through:

- `packages/agents-desktop/src/ipc/register.ts`
- `packages/agents-desktop/src/preload.ts`
- `packages/agents-server-ui/src/lib/server-connection.ts`

The renderer should not write files directly. All install/uninstall behavior
belongs in the Electron main process.

## Onboarding UX

Extend the existing Config step in
`packages/agents-server-ui/src/components/OnboardingModal.tsx`.

Add an "Electric CLI" row:

- title: "Install Electric CLI"
- description: "Adds the `electric` command to your terminal."
- action states:
  - `Install command`
  - `Installed`
  - `Repair`
  - `Managed elsewhere`
  - `Open Settings`

The CLI install should be recommended, not required. Users can continue
onboarding without installing it.

If a manual CLI is detected, do not overwrite it. Show that it is self-managed
and direct users to Settings for details.

If the install directory is not on `PATH`, surface a short warning but still let
the user continue.

## Settings UX

Add a Settings surface for command line tools.

Option A: add a new category:

```text
Settings -> Command Line
```

Option B: add a row under General -> Setup that opens a panel or subpage.

The page should show:

- installed status
- management mode: desktop-managed or self-managed
- resolved binary path
- installed version
- bundled version
- managed shim path, if present
- install directory and whether it is on `PATH`
- latest error, if detection failed

Actions:

- Install command
- Repair managed command
- Uninstall managed command
- Refresh status

Do not offer to uninstall or overwrite a manual install without an explicit
separate flow.

## Platform Notes

### macOS

Packaged executable:

```text
/Applications/Electric Agents.app/Contents/MacOS/Electric Agents
```

CLI resource:

```text
/Applications/Electric Agents.app/Contents/Resources/cli/electric-ax/index.js
```

Prefer installing into `~/.local/bin` or `~/bin`. `/usr/local/bin` can be
supported when writable, but should not be the default if it requires elevation.

### Linux

Use the AppImage/deb executable path discovered from `process.execPath`.

For AppImage, verify that a shim pointing at the current executable remains
valid after app updates. If not, prefer a stable app-managed wrapper path or
refresh/repair during app launch.

### Windows

Install `electric.cmd` into a user bin directory. If we later support PATH
mutation, it must be explicit and reversible.

## Testing Plan

Add unit tests around the CLI service.

Detection tests:

- no `electric` on `PATH`
- current managed shim first on `PATH`
- manual install first on `PATH`
- managed shim exists but is shadowed
- managed shim points to missing app executable
- managed shim points to old CLI resource
- install directory missing from `PATH`
- command version check times out

Shim tests:

- macOS/Linux shim content
- Windows shim content
- marker parsing
- refuses to uninstall unmarked files
- repair replaces only marked managed shims

Packaging smoke tests:

- desktop build includes `Resources/cli/electric-ax/index.js`
- packaged app can run the CLI with `ELECTRON_RUN_AS_NODE=1`
- `electric --version` works through the installed shim

Renderer tests:

- onboarding shows install row when desktop IPC is available
- settings shows managed/manual/not-installed states
- install/repair buttons refresh status after action

## Rollout Plan

1. Add the desktop CLI build artifact for `electric-ax`.
2. Include the artifact in `agents-desktop` packaging.
3. Add CLI status types and the main-process CLI service.
4. Add IPC/preload/renderer wrappers.
5. Add onboarding Config step row.
6. Add Settings command-line tools surface.
7. Add `--version` or `doctor --json` support if needed.
8. Add tests and packaged smoke checks.
9. Add release notes explaining managed vs self-managed CLI installs.

## Open Questions

- Should the managed install create both `electric` and `electric-ax`, or only
  `electric`?
- Should Settings support choosing the install directory, or start with one
  default user-writable location?
- Do we want to mutate shell startup files to add `~/.local/bin` to `PATH`, or
  only show instructions?
- Should `electric --version` return the `electric-ax` package version, the
  desktop app version, or both?
- Should the CLI have a desktop-specific command such as
  `electric desktop status --json` for richer diagnostics?
