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
      description: `Mobile client for Electric Agents — connect to your agents servers and chat with running agents.`,
      version: packageJson.version,
      runtimeVersion: packageJson.version,
      orientation: `portrait`,
      icon: `./assets/icon.png`,
      userInterfaceStyle: `automatic`,
      newArchEnabled: true,
      plugins: [
        `expo-router`,
        `expo-web-browser`,
        // Branded launch screen so cold start shows the logo on the
        // app's dark background instead of a blank white flash.
        [
          `expo-splash-screen`,
          {
            backgroundColor: `#101217`,
            image: `./assets/splash-icon.png`,
            imageWidth: 200,
            resizeMode: `contain`,
            dark: {
              backgroundColor: `#101217`,
              image: `./assets/splash-icon.png`,
            },
          },
        ],
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
            photosPermission: `Electric Agents accesses your photo library so you can attach an existing photo to a chat message.`,
            cameraPermission: `Electric Agents uses your camera so you can take a photo to attach to a chat message.`,
            // The app never records audio; `false` drops the RECORD_AUDIO
            // (Android) + NSMicrophoneUsageDescription (iOS) the plugin adds.
            microphonePermission: false,
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
        // Apple rejects uploads (ITMS-91053) that call "required reason"
        // APIs without declaring them, and doesn't reliably read
        // statically-linked pods' own manifests — so declare app-level.
        // UserDefaults + file timestamp come from AsyncStorage / RN core;
        // system boot time + disk space from Sentry.
        privacyManifests: {
          NSPrivacyTracking: false,
          NSPrivacyTrackingDomains: [],
          NSPrivacyCollectedDataTypes: [
            {
              NSPrivacyCollectedDataType: `NSPrivacyCollectedDataTypeCrashData`,
              NSPrivacyCollectedDataTypeLinked: false,
              NSPrivacyCollectedDataTypeTracking: false,
              NSPrivacyCollectedDataTypePurposes: [
                `NSPrivacyCollectedDataTypePurposeAppFunctionality`,
              ],
            },
            {
              NSPrivacyCollectedDataType: `NSPrivacyCollectedDataTypePerformanceData`,
              NSPrivacyCollectedDataTypeLinked: false,
              NSPrivacyCollectedDataTypeTracking: false,
              NSPrivacyCollectedDataTypePurposes: [
                `NSPrivacyCollectedDataTypePurposeAppFunctionality`,
              ],
            },
          ],
          NSPrivacyAccessedAPITypes: [
            {
              NSPrivacyAccessedAPIType: `NSPrivacyAccessedAPICategoryUserDefaults`,
              NSPrivacyAccessedAPITypeReasons: [`CA92.1`],
            },
            {
              NSPrivacyAccessedAPIType: `NSPrivacyAccessedAPICategoryFileTimestamp`,
              NSPrivacyAccessedAPITypeReasons: [`C617.1`],
            },
            {
              NSPrivacyAccessedAPIType: `NSPrivacyAccessedAPICategorySystemBootTime`,
              NSPrivacyAccessedAPITypeReasons: [`35F9.1`],
            },
            {
              NSPrivacyAccessedAPIType: `NSPrivacyAccessedAPICategoryDiskSpace`,
              NSPrivacyAccessedAPITypeReasons: [`E174.1`],
            },
          ],
        },
      },
      android: {
        ...config.android,
        package: applicationId,
        versionCode,
        edgeToEdgeEnabled: true,
        // expo-image-picker declares these, but the app uses the system
        // photo picker (content URIs) and never records audio, so block
        // them to keep the AAB permission list clean. WRITE_EXTERNAL_STORAGE
        // is deliberately left in place: image-picker's pre-Android-10
        // (API < 29) camera path hard-requires it, so blocking it breaks
        // "take a photo" on Android 7–9.
        blockedPermissions: [
          `android.permission.RECORD_AUDIO`,
          `android.permission.READ_EXTERNAL_STORAGE`,
        ],
        adaptiveIcon: {
          foregroundImage: `./assets/adaptive-icon.png`,
          // Android 13+ themed (monochrome) icons — white silhouette
          // the launcher tints to match the user's wallpaper.
          monochromeImage: `./assets/adaptive-icon-monochrome.png`,
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
