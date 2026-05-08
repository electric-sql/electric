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

## Implementation Plan

### 1. Add Desktop Packaging

Update `packages/agents-desktop` with:

- `electron-builder` dependency and config.
- scripts such as:
  - `dist`: build and package without publishing.
  - `publish:desktop`: build and publish release artifacts.
- platform targets:
  - macOS: `.dmg` and `.zip`.
  - Windows: `.exe` installer.
  - Linux: `.AppImage` and optionally `.deb`.

Also fix packaged production paths. `main.ts` currently loads the renderer from
`../agents-server-ui/dist-desktop/index.html`, which works in the monorepo but
needs to resolve from packaged app resources once distributed.

Native modules need explicit attention:

- `better-sqlite3`
- `sqlite-vec`

They should be rebuilt for Electron and unpacked if required by the packager.

### 2. Add PR Build Workflow

Create a desktop PR workflow that runs when relevant files change:

- `packages/agents-desktop/**`
- `packages/agents-server-ui/**`
- `packages/agents/**`
- `packages/agents-runtime/**`
- `pnpm-lock.yaml`
- desktop packaging workflow/config files

The workflow should:

- install only the affected workspace closure where practical;
- build dependencies;
- run `pnpm --filter @electric-ax/agents-desktop typecheck`;
- run the desktop packaging command with publishing disabled;
- upload unsigned artifacts with short retention.

Start with a full platform matrix if runner cost is acceptable:

- `macos-latest`
- `windows-latest`
- `ubuntu-latest`

If cost or signing complexity is a concern, start with Linux artifact packaging
and macOS/Windows build smoke checks, then expand.

### 3. Publish Canary Builds From `main`

Add a `main` workflow that runs on the same relevant path filters and publishes
a moving prerelease, for example:

- tag/release: `agents-desktop-canary`
- title: `Electric Agents Desktop Canary`

Recommended artifact names should be stable and platform-specific, for example:

- `Electric-Agents-canary-mac-arm64.dmg`
- `Electric-Agents-canary-mac-x64.dmg`
- `Electric-Agents-canary-windows-x64.exe`
- `Electric-Agents-canary-linux-x64.AppImage`

The release body should include:

- source commit SHA;
- workflow run URL;
- build timestamp;
- warning that canary builds are unsigned or pre-release unless signing is
  already configured.

Stable canary URLs make website links simple because they can point at the
moving GitHub release assets.

### 4. Hook Full Releases Into Changesets

Extend `.github/workflows/changesets_release.yml` to capture desktop package
publishing:

```sh
PUBLISHED_PACKAGES='${{ steps.changesets.outputs.publishedPackages }}'
jq -r '.[] | select(.name == "@electric-ax/agents-desktop") | .version'
```

When a desktop version is published:

- call a reusable desktop release workflow;
- build platform artifacts;
- upload artifacts to the GitHub release associated with the Changesets tag, or
  create a cleaner alias tag such as `agents-desktop-v${version}`.

Prefer the alias tag for public download URLs. Scoped package tags like
`@electric-ax/agents-desktop@0.1.0` are valid but awkward in website links and
manual sharing.

### 5. Add Website Download Links

Add a small data source for desktop downloads, for example:

```text
website/data/agents-desktop-downloads.json
```

The Agents landing page can render:

- stable release download links;
- canary download links;
- platform labels and file types;
- a note about signing/notarization status while early releases are unsigned.

The stable links should be updated as part of the Changesets release flow. The
canary links can remain fixed because the canary release tag is moving.

### 6. Add Signing and Notarization

Treat signing as required for public release quality, but allow unsigned PR and
early canary artifacts for internal testing.

Required secrets for macOS notarization will likely include:

- Developer ID Application certificate, base64 encoded;
- certificate password;
- temporary keychain password;
- Apple ID;
- app-specific Apple password;
- Apple team ID.

Windows signing should be added once the certificate/provider is chosen.

### 7. Add Auto-Update Later

Do not block initial CI publishing on auto-update.

Once signed release artifacts are reliable:

- add update metadata generation;
- choose between GitHub Releases/update.electronjs.org and a custom update
  provider;
- wire the Electron main process to check for updates.

## Suggested Phasing

1. Package locally and produce unsigned PR artifacts.
2. Publish unsigned canary builds from `main`.
3. Integrate desktop release artifacts into Changesets full releases.
4. Add website download links for stable and canary builds.
5. Add signing, notarization, and auto-update.

## Open Decisions

- Which platforms should be release-blocking for v1?
- Should full release assets live on the Changesets package tag or an
  `agents-desktop-v${version}` alias tag?
- Are unsigned canaries acceptable on `main` while signing is configured?
- Which Windows signing provider/certificate will be used?
- Should the website promote canary downloads before the first signed stable
  desktop release?
