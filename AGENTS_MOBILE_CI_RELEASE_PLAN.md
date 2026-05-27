# Electric Agents Mobile CI and Release Plan

## Goal

Get `packages/agents-mobile` building reliably in CI and publishing through Expo/EAS with a workflow that mirrors `packages/agents-desktop`:

- PR builds for review and smoke testing.
- Canary builds from `main`.
- Stable release builds triggered by the existing changesets release workflow.

The mobile app is an Expo app. We should lean on Expo tooling for native builds, signing, submission, and preview distribution. Expo Go remains useful for local development where it works, but CI should prove the production build path because the app uses Expo DOM Components.

## Current State

`@electric-ax/agents-mobile` is already a workspace package and Expo SDK 54 app. It uses Expo Router, React Native, and Expo DOM Components to embed selected `agents-server-ui` surfaces.

Draft PR: https://github.com/electric-sql/electric/pull/4408

Implemented so far:

- Android PR preview builds via EAS internal distribution.
- Android canary builds from `main` via EAS internal distribution.
- Android stable release builds from Changesets via EAS production profile and Google Play Submit.
- Manual iOS simulator builds via EAS, before Apple Developer signing is available.
- Expo project, GitHub `EXPO_TOKEN`, Google Play app, and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` are configured.

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

Implemented package/config changes:

- `packages/agents-mobile/app.config.ts` now owns release metadata; the stale static `app.json` has been removed.
- `packages/agents-mobile/eas.json` now defines development, preview, preview-ios-simulator, canary, canary-store, and production profiles.
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
- Use EAS internal distribution for canary validation until we deliberately enable Google Play internal-track submission.
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

- Add optional/manual iOS simulator builds before Apple Developer setup.
- Add signed iOS internal builds after Apple Developer setup.
- Optionally add EAS Update preview comments for Expo Go/dev-build convenience, but not as the main CI artifact.

### Canary

Purpose: continuously publish the latest `main` mobile build to internal testers.

Initial scope:

- Android build from `main`.
- Publish an EAS internal distribution build.
- Use an EAS `canary` profile.
- Trigger only when mobile-impacting files change.

Later:

- Optionally add a second `canary-store` submission job to publish to the Google Play internal track.
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

### iOS Simulator

Purpose: prove that the app can compile as a native iOS app before Apple Developer signing is available.

Initial scope:

- Use an EAS `preview-ios-simulator` profile with `ios.simulator: true`.
- Trigger manually via `agents_mobile_ios_simulator.yml`.
- Run the same mobile dependency build, typecheck, Expo doctor, Android export, and iOS export checks before starting the EAS build.
- Do not require Apple Developer credentials, provisioning profiles, App Store Connect, or TestFlight.

Limitations:

- Simulator artifacts are for local simulator testing only; they cannot be installed on physical devices.
- This does not validate App Store signing, entitlements, TestFlight submission, or App Review metadata.
- Signed device/TestFlight builds remain blocked on Apple Developer account access.

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

- Done: final Android package id is `com.electricsql.agents.mobile`.
- Done: Google Play app is created.
- Done: Google Play service account has been created and invited to the Play Console app.
- Done: Google Play service account JSON is stored as the GitHub Actions repository secret `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- Still possible: initial manual upload may be required if Google blocks API-based submission until the first AAB is uploaded through Play Console.
- Track decision:
  - Canary: EAS internal distribution first; Google Play internal track is possible via `canary-store` but not yet enabled in CI.
  - Stable: production track, or staged rollout if preferred.
  - Google Play app/store setup questionnaires may still need finishing before production release.

### Apple

Apple publishing should remain planned but disabled until the account exists. iOS simulator builds can run before that because they do not require signing.

Needed later:

- Apple Developer account.
- Bundle id, matching Android: `com.electricsql.agents.mobile`.
- App Store Connect app.
- EAS-managed iOS credentials.
- Signed iOS internal distribution profile.
- TestFlight submit profile.

## Package and Config Changes

### App Config

`packages/agents-mobile/app.config.ts` owns build metadata derived from CI environment variables and `package.json`.

The config includes:

- `name`: `Electric Agents`
- `slug`: `agents-mobile`
- `scheme`: `electric-agents`
- `version`: from `packages/agents-mobile/package.json`
- `runtimeVersion`: from `packages/agents-mobile/package.json`, matching the native app version because we are not using EAS Update initially
- `extra.eas.projectId`: `11a024df-c681-4374-867a-5c5905be9133`
- `owner`: `electric-ax`
- `android.package`: `com.electricsql.agents.mobile`
- `android.versionCode`: from CI
- `ios.bundleIdentifier`: `com.electricsql.agents.mobile`
- `ios.buildNumber`: from CI
- `ios.infoPlist.ITSAppUsesNonExemptEncryption`: `false`, assuming the app only uses standard/exempt encryption such as HTTPS.

### EAS Config

`packages/agents-mobile/eas.json` includes:

- `development`: for local development builds if needed.
- `preview`: internal distribution, Android APK.
- `preview-ios-simulator`: unsigned iOS simulator build.
- `canary`: internal distribution Android APK.
- `canary-store`: store-submittable Android build targeting the Play internal track.
- `production`: store-submittable Android App Bundle.

Current shape:

```json
{
  "cli": {
    "version": ">= 15.0.0",
    "appVersionSource": "local"
  },
  "build": {
    "preview": {
      "node": "24.11.1",
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "preview-ios-simulator": {
      "node": "24.11.1",
      "distribution": "internal",
      "ios": {
        "simulator": true
      }
    },
    "canary": {
      "node": "24.11.1",
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "canary-store": {
      "node": "24.11.1",
      "distribution": "store"
    },
    "production": {
      "node": "24.11.1",
      "distribution": "store"
    }
  },
  "submit": {
    "canary-store": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "internal"
      }
    },
    "production": {
      "android": {
        "serviceAccountKeyPath": "./google-service-account.json",
        "track": "production"
      }
    }
  }
}
```

Start with local app versioning because changesets already owns package versions. If we later want EAS remote versioning for `versionCode` / `buildNumber`, switch deliberately after confirming it does not fight the changesets release flow.

### Scripts

Scripts in `packages/agents-mobile/package.json`:

- `doctor`: runs `expo-doctor`.
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
.github/workflows/agents_mobile_ios_simulator.yml
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

- `channel`: `pr`, `canary`, `stable`, or `ios-simulator`
- `version`
- `git_ref`
- `platform`: `android`, `ios`, or `all`
- `profile`: `preview`, `preview-ios-simulator`, `canary`, `canary-store`, or `production`
- `submit`: boolean
- `release_tag`: optional
- `release_name`: optional

Steps:

1. Checkout `git_ref`.
2. Setup pnpm and Node from `.tool-versions`.
3. Install mobile dependency closure.
4. Build the mobile dependency closure so clean runners can resolve workspace exports.
5. Run `pnpm --filter @electric-ax/agents-mobile run ci:check`.
6. Run iOS export when the requested platform is `ios` or `all`.
7. Setup EAS via `expo/expo-github-action`.
8. If `submit` is true for Android, write `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` to `packages/agents-mobile/google-service-account.json`.
9. Run `eas build --platform <platform> --profile <profile> --non-interactive --wait --json`.
10. If `submit` is true, run EAS Submit via `--auto-submit`.
11. For PRs, update a sticky PR comment with build status and EAS build URL.

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
- Google Play internal track later via the `canary-store` profile if we choose to enable canary store submission.

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

### `agents_mobile_ios_simulator.yml`

Manual workflow with inputs:

- `git_ref`: optional branch, tag, or SHA to build.

Behavior:

- Calls `agents_mobile_build.yml` with:
  - `channel: ios-simulator`
  - `profile: preview-ios-simulator`
  - `platform: ios`
  - `submit: false`
- Requires `EXPO_TOKEN`.
- Does not require Apple Developer credentials.

This workflow is intentionally manual at first to control EAS build volume and because simulator artifacts are useful for targeted iOS smoke testing rather than every PR.

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
- Not enabled yet: submit canary builds to Google Play internal track using the `canary-store` profile and `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`.
- iOS canaries remain blocked until Apple Developer/TestFlight setup is available.

### Phase 4: Add Stable Release Publishing

- Done: extended `changesets_release.yml`.
- Done: capture mobile release tag/version from `publishedPackages`.
- Done: trigger Android production EAS build when `@electric-ax/agents-mobile` is published.
- Done: write `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` to a temporary CI file for EAS Submit.
- Done: submit stable Android builds to the Google Play production track through EAS Submit.
- Still possible: Google Play may require an initial manual AAB upload or additional store setup before the first API-based production submission succeeds.

### Phase 5: Add iOS

Before the Apple Developer account is ready:

- Done: iOS export check passes locally and in mobile CI checks.
- Done: added `preview-ios-simulator` EAS profile.
- Done: added manual `agents_mobile_ios_simulator.yml` workflow.
- Done: set `ITSAppUsesNonExemptEncryption` to `false` to avoid App Store Connect encryption metadata blocking simulator/TestFlight setup for standard HTTPS-only encryption.
- Done: confirmed native iOS simulator compilation with EAS build `8b8a5b65-a189-4319-83ae-baaacca23f97`.
  - Simulator artifact: `https://expo.dev/artifacts/eas/iepfJtpqS5QpRP1ktVDT8v.tar.gz`
- Note: the manual `agents_mobile_ios_simulator.yml` workflow can only be dispatched from GitHub after the workflow file exists on the default branch.

After the Apple Developer account is ready:

- Add bundle id and App Store Connect app.
- Configure EAS iOS credentials.
- Enable signed iOS preview/canary builds.
- Add TestFlight submission.
- Enable stable iOS release submission.

## Open Decisions

- Whether stable Android releases go directly to production or use staged rollout.
- Whether PR EAS builds should run on every impacted PR or require a label to control build volume/cost.
- Whether to keep `private: true` on `@electric-ax/agents-mobile`. Changesets can version/tag private packages in this repo, so this does not block release orchestration.
- Whether to enable Google Play internal-track canary submission now or keep canaries on EAS internal distribution until after the first stable submission proves the Play path.

## Next Steps

Immediate:

- Finish the remaining Google Play setup questionnaires/listing requirements so the first production submission is not blocked by Play Console metadata.
- Decide whether Android stable releases should submit directly to production or use a staged rollout/internal track first.
- Decide whether to enable `canary-store` submissions to the Play internal track.
- Land PR #4408 so the manual iOS simulator workflow exists on the default branch and can be dispatched from GitHub.

After Apple Developer access:

- Create the Bundle ID and App Store Connect app for `com.electricsql.agents.mobile`.
- Configure EAS-managed iOS signing credentials.
- Add signed iOS preview/canary/TestFlight profiles.
- Extend Changesets release publishing for iOS/TestFlight/App Store.
