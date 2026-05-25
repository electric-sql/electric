import type { ConfigContext, ExpoConfig } from 'expo/config'

const packageJson = require(`./package.json`) as { version: string }

const projectId = `11a024df-c681-4374-867a-5c5905be9133`
const applicationId = `com.electricsql.agents.mobile`
const buildNumber = process.env.ELECTRIC_AGENTS_MOBILE_BUILD_NUMBER ?? `1`

export default ({ config }: ConfigContext): ExpoConfig => ({
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
  plugins: [`expo-router`, `expo-web-browser`],
  ios: {
    ...config.ios,
    bundleIdentifier: applicationId,
    buildNumber,
    supportsTablet: true,
  },
  android: {
    ...config.android,
    package: applicationId,
    versionCode: parseBuildNumber(buildNumber),
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
})

function parseBuildNumber(value: string): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}
