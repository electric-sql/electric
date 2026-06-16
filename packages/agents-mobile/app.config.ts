import type { ConfigContext, ExpoConfig } from 'expo/config'

const { withSentry } = require(`@sentry/react-native/expo`)

const packageJson = require(`./package.json`) as { version: string }

const projectId = `11a024df-c681-4374-867a-5c5905be9133`
const applicationId = `com.electricsql.agents.mobile`
const versionCode = resolveVersionCode()

// org/project are public; the upload secret is the EAS env var SENTRY_AUTH_TOKEN.
const sentryOrganization = `electricsql-04`
const sentryProject = `agents-mobile`

export default ({ config }: ConfigContext): ExpoConfig =>
  withSentry(
    {
      ...config,
      name: `Electric Agents`,
      slug: `agents-mobile`,
      owner: `electric-ax`,
      scheme: `electric-agents`,
      version: packageJson.version,
      runtimeVersion: packageJson.version,
      orientation: `portrait`,
      // App icon — the Electric mark (cyan bolt on dark). Without this Expo
      // prebuild falls back to its default placeholder icon, which on Android
      // produced a green-robot launcher icon that didn't match the Play Store
      // listing and got the app rejected for a "store listing mismatch".
      icon: `./assets/icon.png`,
      userInterfaceStyle: `automatic`,
      newArchEnabled: true,
      plugins: [
        `expo-router`,
        `expo-web-browser`,
        // The chat WebView (Expo DOM / streamdown) ships regex lookbehind,
        // which JavaScriptCore only parses on iOS 16.4+. Below that the whole
        // DOM bundle fails to parse and the chat renders blank.
        [`expo-build-properties`, { ios: { deploymentTarget: `16.4` } }],
        // Android-only: forward new intents in MainActivity.kt so
        // OAuth redirect deep links delivered after the Chrome
        // Custom Tab dismisses actually reach expo-linking /
        // expo-web-browser. See `plugins/with-android-on-new-intent.js`
        // for the underlying Expo issue.
        `./plugins/with-android-on-new-intent.js`,
        // Image attachments in the composer. The plugin injects the iOS
        // photo-library / camera usage strings; a dev build (not Expo Go) is
        // required for the native module.
        [
          `expo-image-picker`,
          {
            photosPermission: `Allow Electric Agents to attach photos to messages.`,
            cameraPermission: `Allow Electric Agents to take a photo to attach to a message.`,
          },
        ],
      ],
      ios: {
        ...config.ios,
        bundleIdentifier: applicationId,
        buildNumber: String(versionCode),
        infoPlist: {
          ...config.ios?.infoPlist,
          ITSAppUsesNonExemptEncryption: false,
        },
        supportsTablet: true,
      },
      android: {
        ...config.android,
        package: applicationId,
        versionCode,
        edgeToEdgeEnabled: true,
        // Adaptive launcher icon: the cyan bolt mark centered within the
        // safe zone over the brand's dark background (#101217). This is what
        // the launcher actually installs, so it must match the store icon.
        adaptiveIcon: {
          foregroundImage: `./assets/adaptive-icon.png`,
          backgroundColor: `#101217`,
        },
      },
      extra: {
        ...config.extra,
        router: config.extra?.router ?? {},
        eas: {
          ...(config.extra?.eas ?? {}),
          projectId,
        },
      },
    },
    {
      // EU region — must match the DSN host (`ingest.de.sentry.io`) so
      // sentry-cli uploads source maps to the right org/project.
      url: `https://de.sentry.io/`,
      organization: sentryOrganization,
      project: sentryProject,
    }
  )

// versionCode / buildNumber must be monotonically increasing across every
// upload to Google Play and App Store Connect, including across separate
// CI workflows (canary, production). CI writes `.build-info.json` before
// invoking `eas build` so the value is consistent whether `app.config.ts`
// is evaluated on the GitHub runner or on the EAS Build server (the file
// is part of the project tarball uploaded to EAS).
function resolveVersionCode(): number {
  const fromEnv = process.env.ELECTRIC_AGENTS_MOBILE_VERSION_CODE
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  try {
    const info = require(`./.build-info.json`) as { versionCode?: number }
    if (typeof info.versionCode === `number` && info.versionCode > 0) {
      return info.versionCode
    }
  } catch {
    // No build-info file — fall through to dev fallback.
  }
  return Math.floor(Date.now() / 1000)
}
