# Desktop App Publish Plan

## Goal

Configure CI/CD for `packages/agents-desktop` so the Electric Agents desktop app
is packaged consistently, published as canary builds from `main`, attached to
full Changesets releases, and made discoverable from the website.

## Current State

- `packages/agents-desktop` builds the Electron main/preload bundles and reuses
  the `agents-server-ui` desktop renderer build.
- The package has no desktop packager yet: no installer targets, no release
  publisher, no signing/notarization, and no update metadata.
- Changesets already supports private packages via:

  ```json
  "privatePackages": { "tag": true, "version": true }
  ```

- `@electric-ax/agents-desktop` is already covered by Changesets, so full
  releases can be triggered from package version/tag events rather than a
  parallel release mechanism.

## Recommended Packaging Tool

Use `electron-builder`.

Reasons:

- The app is already a Vite/Electron package rather than an Electron Forge app.
- `electron-builder` can package the existing output with less restructuring.
- It has mature GitHub Releases publishing support and generates update metadata
  for future auto-update work.
- It handles common desktop targets across macOS, Windows, and Linux.

Electron Forge is viable, but adopting it would require more package reshaping.
For this repo, `electron-builder` is the lower-friction path.

## Release Targets

Build and publish these artifacts:

| Platform | Architecture          | Runner                           | Artifact                       |
| -------- | --------------------- | -------------------------------- | ------------------------------ |
| macOS    | Apple Silicon / arm64 | `macos-14` or newer arm64 runner | signed `.dmg` and `.zip`       |
| macOS    | Intel / x64           | `macos-13` or x64 macOS runner   | signed `.dmg` and `.zip`       |
| Windows  | x64                   | `windows-latest`                 | signed `.exe` installer        |
| Linux    | x64                   | `ubuntu-latest`                  | `.AppImage`, optionally `.deb` |

macOS must be built separately for `arm64` and `x64`. Do not rely on one
architecture to cross-build the other until the native module packaging path is
proven, because the desktop app depends on native modules such as
`better-sqlite3` and `sqlite-vec`.

Universal macOS builds can be considered later, but the first release path
should publish separate Intel and Apple Silicon downloads. This keeps signing,
notarization, and native module debugging simpler.

## Tools

- `electron-builder`: packages Electron apps, creates installers, publishes to
  GitHub Releases, and emits update metadata for future auto-update work.
- `electron-rebuild` or `@electron/rebuild`: rebuilds native modules against the
  Electron ABI during install/package preparation.
- `@electron/notarize`: used by `electron-builder` for macOS notarization when
  signing secrets are present.
- GitHub Actions: runs PR builds, main canaries, and full release builds.
- GitHub Releases: stores stable and canary desktop artifacts.
- Changesets: versions `@electric-ax/agents-desktop` and decides when a stable
  desktop release should run.
- `gh` CLI: creates/updates canary releases and uploads release assets when
  `electron-builder` is not the best fit for a particular upload step.

## Package Changes

Update `packages/agents-desktop` with:

- `electron-builder` config in either `package.json` or
  `electron-builder.yml`.
- a native rebuild step for Electron:
  - during packaging via `electron-builder install-app-deps`, or
  - explicitly via `@electron/rebuild`.
- scripts:
  - `build`: current Vite/Electron build.
  - `dist`: build and package with `--publish never`.
  - `dist:mac`: package macOS for the runner architecture.
  - `dist:win`: package Windows.
  - `dist:linux`: package Linux.
  - `publish:desktop`: package and publish with `--publish always`.

Initial `electron-builder` config should define:

- `appId`: `com.electric-sql.agents`.
- `productName`: `Electric Agents`.
- `directories.output`: `release`.
- `files`: compiled desktop files, `package.json`, and required runtime assets.
- `extraResources`: the `agents-server-ui/dist-desktop` renderer output.
- `asarUnpack`: native modules and any runtime files that must remain unpacked.
- `publish.provider`: `github`.
- `publish.owner`: `electric-sql`.
- `publish.repo`: `electric`.
- artifact names that include channel, platform, version, and architecture.

Fix production path resolution in `main.ts`. Today the app loads:

```text
../agents-server-ui/dist-desktop/index.html
```

That path is monorepo-relative and will not be correct once packaged. The
packaged app should resolve the renderer from `process.resourcesPath` when
`app.isPackaged` is true, while keeping the current monorepo path for local
`pnpm start`/development.

## CI Workflow Design

Create one reusable workflow:

```text
.github/workflows/agents_desktop_build.yml
```

Use `workflow_call` inputs:

- `channel`: `pr`, `canary`, or `stable`.
- `version`: package version or canary identifier.
- `git_ref`: commit/tag to build.
- `publish`: boolean.
- `sign`: boolean.
- `release_tag`: GitHub release tag to upload to.
- `release_name`: GitHub release title.

Use a matrix:

```text
macos-arm64: runs-on macos-14 or arm64 macOS runner, arch arm64
macos-x64: runs-on macos-13 or x64 macOS runner, arch x64
windows-x64: runs-on windows-latest, arch x64
linux-x64: runs-on ubuntu-latest, arch x64
```

Each matrix job should:

1. Check out `git_ref`.
2. Set up pnpm and Node from `.tool-versions`.
3. Install dependencies with a filter rooted at `@electric-ax/agents-desktop`.
4. Build dependency packages.
5. Run desktop typecheck.
6. Build the desktop app.
7. Rebuild Electron native modules for the target platform/arch.
8. Import signing credentials if `sign == true`.
9. Run `electron-builder` for the platform/arch.
10. Upload artifacts to GitHub Actions.
11. If `publish == true`, upload assets to the target GitHub Release.

The reusable workflow gives PR, canary, and stable releases the same build path.
The only differences should be channel, signing, release tag, and whether assets
are published.

## PR Build Workflow

Create:

```text
.github/workflows/agents_desktop_pr.yml
```

Trigger on `pull_request` for:

- `packages/agents-desktop/**`
- `packages/agents-server-ui/**`
- `packages/agents/**`
- `packages/agents-runtime/**`
- `.github/workflows/agents_desktop_*.yml`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

Call the reusable workflow with:

- `channel`: `pr`
- `version`: `pr-${{ github.event.pull_request.number }}-${{ github.sha }}`
- `git_ref`: pull request head SHA
- `publish`: `false`
- `sign`: `false`

Artifacts should be unsigned and uploaded to the workflow run with short
retention, for example 7 days. These are smoke-test artifacts, not public
downloads.

## Canary Builds From `main`

Create:

```text
.github/workflows/agents_desktop_canary.yml
```

Trigger on `push` to `main` using the same desktop path filters.

Call the reusable workflow with:

- `channel`: `canary`
- `version`: `canary-${{ github.run_number }}-${{ github.sha }}`
- `git_ref`: `${{ github.sha }}`
- `publish`: `true`
- `sign`: preferably `true` once secrets are configured; otherwise `false`
- `release_tag`: `agents-desktop-canary`
- `release_name`: `Electric Agents Desktop Canary`

Before uploading assets, delete or replace the previous canary assets so URLs
remain stable. Publish fixed names such as:

- `Electric-Agents-canary-mac-arm64.dmg`
- `Electric-Agents-canary-mac-x64.dmg`
- `Electric-Agents-canary-windows-x64.exe`
- `Electric-Agents-canary-linux-x64.AppImage`

The canary release body should include:

- source commit SHA;
- workflow run URL;
- build timestamp;
- package version from `packages/agents-desktop/package.json`;
- signing/notarization status;
- warning that canary builds are pre-release quality.

## Stable Releases Through Changesets

Keep Changesets as the source of truth for stable desktop releases.

`changesets_release.yml` currently runs `changesets/action`, publishes packages,
captures selected package tags, and triggers follow-up release jobs such as
Docker publishing. Extend that workflow with a desktop output:

```text
desktop_release_version
desktop_release_tag
```

Derive those from `steps.changesets.outputs.publishedPackages` by selecting
`@electric-ax/agents-desktop`.

When `@electric-ax/agents-desktop` is present:

1. Set `desktop_release_version` to the published version.
2. Set `desktop_release_tag` to the Changesets-created package tag,
   `@electric-ax/agents-desktop@${version}`.
3. Create or update that GitHub Release.
4. Call `.github/workflows/agents_desktop_build.yml` with:
   - `channel`: `stable`
   - `version`: `${version}`
   - `git_ref`: `@electric-ax/agents-desktop@${version}`
   - `publish`: `true`
   - `sign`: `true`
   - `release_tag`: `@electric-ax/agents-desktop@${version}`
   - `release_name`: `Electric Agents Desktop v${version}`
5. Upload the macOS arm64, macOS x64, Windows, and Linux artifacts.
6. Update website download metadata after successful artifact upload.

Use the Changesets package tag for public desktop assets. This keeps stable
desktop artifacts attached to the same release event that versioned
`@electric-ax/agents-desktop`.

The Changesets release PR should still update:

- `packages/agents-desktop/package.json`
- `packages/agents-desktop/CHANGELOG.md`, once a changelog exists
- any linked internal package versions

The desktop artifact build should happen only after the Changesets publish step
reports that the desktop package was included. This prevents every package
release from rebuilding desktop artifacts unnecessarily.

## Website Download Links

Add:

```text
website/data/agents-desktop-downloads.json
```

The file should contain:

- latest stable desktop version;
- stable release tag;
- canary release tag;
- per-platform download asset names;
- whether each channel is signed/notarized.

The Agents landing page can render:

- "Download for macOS Apple Silicon";
- "Download for macOS Intel";
- "Download for Windows";
- "Download for Linux";
- "Canary builds" as a secondary/pre-release section.

For stable releases, update the website data file as part of the Changesets
release flow after desktop assets are uploaded. That update can be a direct
commit from CI or, preferably, a small automated PR if we want review on website
copy changes.

For canaries, keep the website URLs fixed against `agents-desktop-canary`; no
website update is needed per canary.

## Signing and Notarization

### macOS

macOS public releases should be signed with a Developer ID Application
certificate and notarized by Apple.

Use `electron-builder` mac signing plus `@electron/notarize`.

Required GitHub secrets:

- `MACOS_DEVELOPER_ID_CERTIFICATE_BASE64`: base64-encoded `.p12` certificate.
- `MACOS_DEVELOPER_ID_CERTIFICATE_PASSWORD`: password for the `.p12`.
- `MACOS_KEYCHAIN_PASSWORD`: temporary CI keychain password.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

For notarization, prefer App Store Connect API key auth:

- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER_ID`
- `APPLE_API_KEY_P8`

Alternative notarization auth, if API key auth is not available:

- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

macOS signing process in CI:

1. Decode the `.p12` certificate.
2. Create a temporary keychain.
3. Import the certificate into that keychain.
4. Configure key partition list so `codesign` can access the key non-
   interactively.
5. Run `electron-builder --mac --arm64` on the arm64 runner and
   `electron-builder --mac --x64` on the x64 runner.
6. Let `electron-builder` sign the app bundle.
7. Notarize the signed `.dmg`/`.zip`.
8. Staple notarization tickets where applicable.
9. Verify with `spctl` and `codesign --verify`.

PR builds should skip this. Stable releases should require it. Canary builds can
start unsigned but should move to signed as soon as the Apple credentials are
available.

### Windows

Windows public releases should be Authenticode signed.

Two viable options:

- Use `electron-builder` certificate signing with:
  - `WIN_CSC_LINK`: base64 certificate or secure URL to a `.p12`/`.pfx`.
  - `WIN_CSC_KEY_PASSWORD`: certificate password.
- Use a managed signing service such as Azure Trusted Signing, with its own
  OIDC/service-principal configuration.

Pick one before public stable release. For the first implementation,
`electron-builder` certificate signing is the simplest path if we already have a
Windows code signing certificate.

Windows signing process in CI:

1. Make the signing certificate available only on release/canary jobs.
2. Run `electron-builder --win --x64`.
3. Let `electron-builder` sign the installer and executable.
4. Verify signatures with `signtool verify`.

PR builds should be unsigned.

### Linux

Linux artifacts do not need code signing for the initial release. If we publish
`.deb`, we can later add package repository signing if we host an apt repository.

## GitHub Permissions and Secrets

Workflow permissions:

- PR build workflow:
  - `contents: read`
- canary and stable workflows:
  - `contents: write` to create/update releases and upload assets

Secrets used by publishing:

- `GITHUB_TOKEN`: provided by GitHub Actions; used by `gh` and
  `electron-builder` for GitHub Releases.
- macOS signing/notarization secrets listed above.
- Windows signing secrets listed above.

Do not expose signing secrets to pull request workflows from forks. Signing
steps should run only on trusted events: `push` to `main`, Changesets stable
release jobs, or manually approved environments.

## Auto-Update

Do not block initial CI publishing on auto-update.

Once signed releases are reliable:

- use `electron-builder` generated update metadata;
- decide between GitHub Releases/update.electronjs.org and a custom update
  provider;
- wire the Electron main process to check for updates.

Because this repository is public and artifacts will live on GitHub Releases,
GitHub-based updates are the likely default. macOS updates require signed builds.

## Implementation Plan

### 1. Add Desktop Packaging

Add `electron-builder`, package config, packaging scripts, native module rebuild
support, and packaged renderer path resolution.

### 2. Add PR Build Workflow

Add `agents_desktop_pr.yml` and call the reusable build workflow with unsigned,
unpublished artifacts for macOS arm64, macOS x64, Windows x64, and Linux x64.

### 3. Publish Canary Builds From `main`

Add `agents_desktop_canary.yml` to publish a moving
`agents-desktop-canary` GitHub prerelease from `main`.

### 4. Hook Full Releases Into Changesets

Extend `changesets_release.yml` so `@electric-ax/agents-desktop` in
`publishedPackages` triggers signed stable artifacts on the Changesets-created
package tag.

### 5. Add Website Download Links

Add `website/data/agents-desktop-downloads.json` and render separate download
links for macOS Apple Silicon, macOS Intel, Windows, Linux, and canary builds.

### 6. Add Signing and Notarization

Add macOS Developer ID signing/notarization and Windows Authenticode signing for
stable releases. Keep PR artifacts unsigned.

### 7. Add Auto-Update Later

Use `electron-builder` update metadata after signed releases are reliable.

## Suggested Phasing

1. Add `electron-builder`, native rebuilds, and packaged renderer resources.
2. Add unsigned PR artifacts for macOS arm64, macOS x64, Windows x64, and Linux
   x64.
3. Add `main` canary publishing to `agents-desktop-canary`.
4. Add macOS signing/notarization and Windows signing secrets.
5. Integrate signed stable desktop artifacts into Changesets releases.
6. Add website download links for stable and canary builds.
7. Add auto-update.

## Decisions

- Release-blocking platforms for v1: Windows x64, macOS Apple Silicon, macOS
  Intel, and Linux x64.
- Full release assets should live on the Changesets package tag rather than a
  separate `agents-desktop-v${version}` alias tag.
- Unsigned canaries are acceptable on `main` while signing is being configured.
  The intent is still to get signing in place before public release if possible.
- Windows signing provider is undecided. Start with the simplest
  `electron-builder` path if a `.pfx` certificate is available; otherwise
  evaluate managed signing such as Azure Trusted Signing.
- Do not promote canary downloads on the website before the first signed stable
  desktop release.
- Keep separate macOS Apple Silicon and Intel downloads. Do not create universal
  macOS builds for the initial release path.
