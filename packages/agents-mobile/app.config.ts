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
      userInterfaceStyle: `automatic`,
      newArchEnabled: true,
      plugins: [
        `expo-router`,
        `expo-web-browser`,
        // Android-only: forward new intents in MainActivity.kt so
        // OAuth redirect deep links delivered after the Chrome
        // Custom Tab dismisses actually reach expo-linking /
        // expo-web-browser. See `plugins/with-android-on-new-intent.js`
        // for the underlying Expo issue.
        `./plugins/with-android-on-new-intent.js`,
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
      url: `https://sentry.io/`,
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
