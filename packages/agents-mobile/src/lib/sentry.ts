import * as Sentry from '@sentry/react-native'

// The DSN is a public client identifier (shipped in every binary), so it is
// safe to hardcode; `EXPO_PUBLIC_SENTRY_DSN` overrides it at bundle time.
const PROD_SENTRY_DSN = `https://ad5267e5eb81745359a9c4db32f22d44@o4508410459127808.ingest.de.sentry.io/4511500591824976`

function resolveDsn(): string {
  const fromEnv = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim()
  return fromEnv && fromEnv.length > 0 ? fromEnv : PROD_SENTRY_DSN
}

export function initSentry(): void {
  Sentry.init({
    dsn: resolveDsn(),
    enabled: !__DEV__,
    tracesSampleRate: 0,
    sendDefaultPii: false,
    environment: __DEV__ ? `development` : `production`,
  })
}

export { Sentry }
