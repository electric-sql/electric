# Electric Agents Mobile CI and Release Plan

## Goal

Get `packages/agents-mobile` building reliably in CI and publishing through Expo/EAS with a workflow that mirrors `packages/agents-desktop`:

- PR builds for review and smoke testing.
- Canary builds from `main`.
- Stable release builds triggered by the existing changesets release workflow.

The mobile app is an Expo app. We should lean on Expo tooling for native builds, signing, submission, and preview distribution. Expo Go remains useful for local development where it works, but CI should prove the production build path because the app uses Expo DOM Components.

## Current State

`@electric-ax/agents-mobile` is already a workspace package and Expo SDK 54 app. It uses Expo Router, React Native, and Expo DOM Components to embed selected `agents-server-ui` surfaces.

Useful checks from the current app:

- `pnpm --filter @electric-ax/agents-mobile run ci:check` passes when run with the repo's configured Node version.
- `pnpm --filter @electric-ax/agents-mobile run export:ios` succeeds.
- `expo-doctor` passes 18/18 checks.
- `expo config --type public` resolves:
  - owner: `electric-ax`
  - slug: `agents-mobile`
  - version/runtimeVersion: from `packages/agents-mobile/package.json`
  - project id: `11a024df-c681-4374-867a-5c5905be9133`
  - Android package / iOS bundle id: `com.electricsql.agents.mobile`

Known gaps:

- `packages/agents-mobile/app.config.ts` now owns release metadata; the stale static `app.json` has been removed.
- `packages/agents-mobile/eas.json` now defines development, preview, canary, canary-store, and production profiles.
- React, WebView, and TypeScript versions have been aligned across the mobile/server-ui/runtime graph so Expo doctor and mobile typecheck pass.
- Authenticated EAS builds will not run on untrusted fork PRs because GitHub does not expose repository secrets to those jobs. Forks should still get local checks; EAS builds should run for same-repository PRs, trusted labeled PRs, or manual dispatch.

## Important Expo Constraints

Expo Go is good for fast local iteration and should remain documented as a developer path.

However, the production CI signal should come from EAS Build, not only Expo Go or EAS Update previews:

- The app uses Expo DOM Components via `'use dom'`.
- DOM Components support Expo Go, but Expo documents that DOM Components are embedded exports and do not currently support OTA updates in the normal EAS Update sense.
- DOM Components have enough production-build-specific behavior that preview and release binaries need to be built and installed as native apps.

Recommendation:

- Use Expo Go for local/manual development where possible.
- Use EAS internal distribution builds for PR validation where repository secrets are available.
- Use Google Play internal-track builds for canary validation once Play submission is configured.
- Use EAS Submit for Google Play and, later, App Store Connect/TestFlight.

## Desired Release Channels

### PR

Purpose: prove that the mobile app builds and produce an installable review artifact.

Initial scope:

- Android only.
- EAS internal distribution build for same-repository or otherwise trusted PRs.
- Local CI checks for all PRs, including fork PRs.
- No app-store submission.
- GitHub PR comment with the EAS build URL.
- Run only when mobile-impacting files change.

Later:

- Add iOS simulator or internal builds after Apple Developer setup.
- Optionally add EAS Update preview comments for Expo Go/dev-build convenience, but not as the main CI artifact.

### Canary

Purpose: continuously publish the latest `main` mobile build to internal testers.

Initial scope:

- Android build from `main`.
- Publish both an EAS internal distribution build and, when Google Play credentials are ready, submit to the Google Play internal track.
- Use an EAS `canary` profile.
- Trigger only when mobile-impacting files change.

Later:

- Add iOS TestFlight once the Apple Developer account is available.

### Stable Release

Purpose: publish store-ready mobile builds when changesets releases `@electric-ax/agents-mobile`.

Initial scope:

- Use the existing changesets release workflow as the source of truth.
- Capture the published `@electric-ax/agents-mobile` version and tag.
- Build Android with a production EAS profile.
- Submit to Google Play using EAS Submit.

Later:

- Add iOS App Store/TestFlight submission from the same release trigger.

## Required Expo and Store Setup

### Expo

- Expo project is linked:
  - owner: `electric-ax`
  - slug: `agents-mobile`
  - project id: `11a024df-c681-4374-867a-5c5905be9133`
- `EXPO_TOKEN` GitHub Actions repository secret is configured using an Expo Developer robot token.
- Configure EAS Build credentials for Android signing.

### Google Play

We have a Google Play account, so Android can be the first publishing target.

Needed:

- Final Android package id: `com.electricsql.agents.mobile`.
- Google Play app created.
- Initial manual upload if Google requires it before API-based submission.
- Google Play service account key configured for EAS Submit, preferably stored in Expo credentials rather than checked into GitHub.
- Track decision:
  - Canary: EAS internal distribution first, plus Google Play internal track when credentials are ready.
  - Stable: production track, or staged rollout if preferred.
  - Google Play app/store setup is deferred until after the first EAS build path is working.

### Apple

Apple publishing should remain planned but disabled until the account exists.

Needed later:

- Apple Developer account.
- Bundle id, matching Android: `com.electricsql.agents.mobile`.
- App Store Connect app.
- EAS-managed iOS credentials.
- TestFlight submit profile.

## Package and Config Changes

### App Config

Replace or augment `app.json` with `app.config.ts` so build metadata can be derived from CI environment variables and `package.json`.

The config should include:

- `name`: `Electric Agents`
- `slug`: `agents-mobile`
- `scheme`: `electric-agents`
- `version`: from `packages/agents-mobile/package.json`
- `runtimeVersion`: a policy chosen after confirming whether we use EAS Update; if no OTA updates are planned initially, keep this conservative and aligned with native build versions
- `extra.eas.projectId`: `11a024df-c681-4374-867a-5c5905be9133`
- `owner`: `electric-ax`
- `android.package`: `com.electricsql.agents.mobile`
- `android.versionCode`: from CI
- `ios.bundleIdentifier`: `com.electricsql.agents.mobile`
- `ios.buildNumber`: from CI

### EAS Config

Add `packages/agents-mobile/eas.json` with at least:

- `development`: for local development builds if needed.
- `preview`: internal distribution, Android APK.
- `canary`: internal distribution or store-submittable Android build.
- `production`: store-submittable Android App Bundle.

Example shape:

```json
{
  "cli": {
    "version": ">= 15.0.0",
    "appVersionSource": "local"
  },
  "build": {
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "canary": {
      "distribution": "store",
      "channel": "canary"
    },
    "production": {
      "distribution": "store",
      "channel": "production"
    }
  },
  "submit": {
    "canary": {
      "android": {
        "track": "internal"
      }
    },
    "production": {
      "android": {
        "track": "production"
      }
    }
  }
}
```

Exact values should be finalized after the Expo project is linked and the Google Play app exists.

Start with local app versioning because changesets already owns package versions. If we later want EAS remote versioning for `versionCode` / `buildNumber`, switch deliberately after confirming it does not fight the changesets release flow.

### Scripts

Add or adjust scripts in `packages/agents-mobile/package.json`:

- `doctor`: either install `expo-doctor` as a dev dependency or run it through `pnpm dlx`.
- `export:android`: `expo export --platform android --output-dir dist/android`
- `export:ios`: `expo export --platform ios --output-dir dist/ios`
- `ci:check`: typecheck, doctor, and Android export.

In GitHub Actions, call package scripts with `pnpm --filter @electric-ax/agents-mobile run <script>`. A bare `pnpm --filter ... doctor` is parsed as pnpm's own `doctor` command, not the package script.

### Dependency Health

Before making EAS builds required:

- Done: aligned `react` and `react-dom` between `agents-mobile` and `agents-server-ui`.
- Done: resolved the Expo SDK expected `react-native-webview` version.
- Done: aligned the runtime/server-ui TypeScript peer graph used by shared TanStack DB types.
- Done: re-ran `expo-doctor`; it now passes 18/18 checks.

## CI Workflow Design

Mirror the desktop workflow structure:

```text
.github/workflows/agents_mobile_pr.yml
.github/workflows/agents_mobile_canary.yml
.github/workflows/agents_mobile_build.yml
scripts/ci/mobile-affected.mjs
```

### `scripts/ci/mobile-affected.mjs`

Model after `scripts/ci/desktop-affected.mjs`.

Inputs:

- `BASE_SHA`

Global changes should trigger mobile builds:

- `.github/workflows/agents_mobile_*.yml`
- `.npmrc`
- `.tool-versions`
- `package.json`
- `patches/**`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `tsconfig.build.json`

Workspace impact should include the mobile package closure:

- `@electric-ax/agents-mobile...`

This should naturally catch changes in:

- `packages/agents-mobile`
- `packages/agents-server-ui`
- `packages/agents-runtime`
- shared workspace dependencies used by mobile

### `agents_mobile_build.yml`

Reusable workflow with inputs:

- `channel`: `pr`, `canary`, or `stable`
- `version`
- `git_ref`
- `platform`: initially `android`
- `profile`: `preview`, `canary`, or `production`
- `submit`: boolean
- `release_tag`: optional
- `release_name`: optional

Steps:

1. Checkout `git_ref`.
2. Setup pnpm and Node from `.tool-versions`.
3. Install mobile dependency closure.
4. Run `pnpm --filter @electric-ax/agents-mobile run ci:check`.
5. Run iOS export when the requested platform is `ios` or `all`.
6. Setup EAS via `expo/expo-github-action`.
7. Run `eas build --platform <platform> --profile <profile> --non-interactive --wait --json`.
8. If `submit` is true, run EAS Submit via `--auto-submit`.
9. For PRs, update a sticky PR comment with build status and EAS build URL.

### `agents_mobile_pr.yml`

Triggers:

- `pull_request`
- `workflow_dispatch`

Behavior:

- Detect mobile impact.
- If impacted, run unauthenticated local checks for every PR.
- If impacted and repository secrets are available, call `agents_mobile_build.yml` with:
  - `channel: pr`
  - `profile: preview`
  - `platform: android`
  - `submit: false`
  - `version: pr-<number>-<sha>`
- If secrets are unavailable, skip EAS Build and comment that the PR needs a maintainer-triggered build.

PR artifact expectation:

- EAS internal distribution Android APK link.
- Sticky PR comment similar to desktop artifact comments.

### `agents_mobile_canary.yml`

Triggers:

- Push to `main`
- `workflow_dispatch`

Behavior:

- Detect mobile impact.
- If impacted, call `agents_mobile_build.yml` with:
  - `channel: canary`
  - `profile: canary`
  - `platform: android`
  - `submit: false` until Google Play submit is configured
  - `version: canary-<run_number>-<sha>` for CI labeling, while app version still comes from package/config

Publishing target:

- EAS internal distribution first.
- Google Play internal track later via `canary-store` profile once Play credentials are configured.

### `changesets_release.yml`

Extend the existing changesets job:

- Add outputs:
  - `mobile_release_version`
  - `mobile_release_tag`
- Capture `@electric-ax/agents-mobile` from `steps.changesets.outputs.publishedPackages`.
- Add a `publish-agents-mobile` job:
  - Needs `changesets`.
  - Runs only when `mobile_release_tag` is non-empty.
  - Calls `agents_mobile_build.yml`.
  - Uses:
    - `channel: stable`
    - `profile: production`
    - `platform: android`
    - `git_ref: ${{ needs.changesets.outputs.mobile_release_tag }}`
    - `submit: true`

## Versioning Strategy

Changesets should continue to own semantic app versions.

Recommended:

- `package.json.version` is the app display version.
- `app.config.ts` reads that version.
- Android `versionCode` is monotonically increasing and generated by CI or an explicit EAS versioning decision.
- iOS `buildNumber` follows the same strategy once enabled.

Avoid tying Android `versionCode` directly to semver components unless we are confident it will never collide or decrease.

## Initial Implementation Phases

### Phase 1: Make the App Build-Ready

- Done: added `app.config.ts`.
- Done: added `eas.json`.
- Done: added final Android package id.
- Done: added reserved iOS bundle id.
- Done: added mobile CI/export scripts.
- Done: fixed `expo-doctor` issues.
- Done: confirmed:
  - mobile typecheck
  - Expo doctor
  - Android export
  - iOS export
  - generated Expo public config

### Phase 2: Add PR Builds

- Done: added `scripts/ci/mobile-affected.mjs`.
- Done: added reusable `agents_mobile_build.yml`.
- Done: added `agents_mobile_pr.yml`.
- Done: Android preview APK builds use EAS internal distribution.
- Done: PR workflow runs unauthenticated local checks for all impacted PRs.
- Done: same-repository/trusted PRs get a sticky EAS build comment; fork PRs get a skip comment.

### Phase 3: Add Canary Builds

- Done: added `agents_mobile_canary.yml`.
- Done: build Android from `main` using the EAS `canary` internal distribution profile.
- Deferred: submit to Google Play internal track after credentials are configured.
- Keep iOS skipped with a clear condition/comment.

### Phase 4: Add Stable Release Publishing

- Extend `changesets_release.yml`.
- Capture mobile release tag/version.
- Trigger Android production EAS build.
- Submit to Google Play production or staged rollout track.

### Phase 5: Add iOS

After the Apple Developer account is ready:

- Add bundle id and App Store Connect app.
- Configure EAS iOS credentials.
- Enable iOS preview/canary builds.
- Add TestFlight submission.
- Enable stable iOS release submission.

## Open Decisions

- Whether stable Android releases go directly to production or use staged rollout.
- Whether PR EAS builds should run on every impacted PR or require a label to control build volume/cost.
- Whether to keep `private: true` on `@electric-ax/agents-mobile`. Changesets can version/tag private packages in this repo, so this does not block release orchestration.

## Recommended First PR

Start with a non-publishing PR:

- Add `app.config.ts`.
- Add `eas.json`.
- Fix mobile package scripts.
- Resolve `expo-doctor` failures.
- Add `mobile-affected.mjs`.
- Add PR workflow local checks for all impacted PRs.
- Add Android preview EAS builds for same-repository/trusted PRs only.

This gives us a working binary build path without needing to finalize Google Play submission in the same change.
