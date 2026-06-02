import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Linking from 'expo-linking'
import type { ReactNode } from 'react'
import { cloudAuth } from './cloudAuth'
import { resolveActiveAfterCloudSignOut } from './availableServers'
import { getCloudServiceIdFromServerUrl } from './cloudAgentUrls'
import {
  addSavedServer,
  getSavedServers,
  removeCloudSavedServers,
} from './savedServers'
import { prepareServerHeaders } from './serverHeaders'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`
const ONBOARDING_DISMISSED_KEY = `electric-agents-mobile.onboarding-dismissed`

function hostOf(url: string): string {
  try {
    return new URL(url).host || url
  } catch {
    return url
  }
}

type MobileAppState = {
  loading: boolean
  serverUrl: string | null
  /** Set (or, with `null`, clear) the active server. */
  saveServerUrl: (next: string | null) => Promise<void>
  launchUrl: string | null
  /**
   * Whether the user has finished or explicitly opted out of the
   * first-launch onboarding wizard (cloud sign-in + server URL).
   * Persisted in `AsyncStorage` so the wizard only auto-shows again
   * if the user uninstalls / clears app data.
   */
  onboardingDismissed: boolean
  setOnboardingDismissed: (next: boolean) => Promise<void>
}

const MobileAppStateContext = createContext<MobileAppState | null>(null)

export function MobileAppStateProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [serverUrl, setServerUrl] = useState<string | null>(null)
  const [launchUrl, setLaunchUrl] = useState<string | null>(null)
  const [onboardingDismissed, setOnboardingDismissedState] = useState(false)

  useEffect(() => {
    void (async () => {
      const [storedUrl, storedOnboarding, initialUrl] = await Promise.all([
        AsyncStorage.getItem(SERVER_URL_KEY),
        AsyncStorage.getItem(ONBOARDING_DISMISSED_KEY),
        Linking.getInitialURL().catch(() => null),
      ])
      // Inject server headers BEFORE flipping `loading` to false so any
      // screen that mounts on the next render already has auth-fetch
      // headers registered. Otherwise a race window lets early fetches
      // go out unauthenticated and 401 against Cloud servers.
      await prepareServerHeaders(storedUrl)
      // Migrate users upgrading from the single-URL model: surface their
      // active self-hosted server in the saved list so it appears in the
      // unified picker. Cloud servers are intentionally skipped — they come
      // from the live shape list (and would be purged on sign-out anyway).
      if (
        storedUrl &&
        getCloudServiceIdFromServerUrl(storedUrl) === null &&
        !getSavedServers().some((s) => s.url === storedUrl)
      ) {
        addSavedServer({
          id: storedUrl,
          name: hostOf(storedUrl),
          url: storedUrl,
          source: `manual`,
        })
      }
      setServerUrl(storedUrl)
      setLaunchUrl(initialUrl)
      setOnboardingDismissedState(storedOnboarding === `true`)
      setLoading(false)
    })()
  }, [])

  const persistServerUrl = useCallback(
    async (next: string | null): Promise<void> => {
      if (next) {
        await AsyncStorage.setItem(SERVER_URL_KEY, next)
      } else {
        await AsyncStorage.removeItem(SERVER_URL_KEY)
      }
      setServerUrl(next)
    },
    []
  )

  // Re-apply headers on cloud-auth transitions so a fresh sign-in
  // immediately makes the agents-token available to in-flight
  // collections without restarting the app. Also re-runs on serverUrl
  // change (covers `saveServerUrl`).
  //
  // On sign-out we additionally purge persisted Cloud servers and, if the
  // active server was a Cloud server (now unreachable without a token),
  // fall back to a remaining self-hosted server — or clear the active
  // server, which routes the user to the server-setup screen.
  useEffect(() => {
    if (loading) return
    const apply = (): void => {
      if (cloudAuth.getState().status === `signed-out`) {
        removeCloudSavedServers()
        const next = resolveActiveAfterCloudSignOut(
          serverUrl,
          getSavedServers()
        )
        if (next.changed) {
          void persistServerUrl(next.url)
          return
        }
      }
      void prepareServerHeaders(serverUrl)
    }
    apply()
    const unsubscribe = cloudAuth.subscribe(apply)
    return unsubscribe
  }, [serverUrl, loading, persistServerUrl])

  const value = useMemo<MobileAppState>(
    () => ({
      loading,
      serverUrl,
      launchUrl,
      saveServerUrl: persistServerUrl,
      onboardingDismissed,
      setOnboardingDismissed: async (next: boolean) => {
        if (next) {
          await AsyncStorage.setItem(ONBOARDING_DISMISSED_KEY, `true`)
        } else {
          await AsyncStorage.removeItem(ONBOARDING_DISMISSED_KEY)
        }
        setOnboardingDismissedState(next)
      },
    }),
    [loading, serverUrl, launchUrl, onboardingDismissed, persistServerUrl]
  )

  return (
    <MobileAppStateContext.Provider value={value}>
      {children}
    </MobileAppStateContext.Provider>
  )
}

export function useMobileAppState(): MobileAppState {
  const value = useContext(MobileAppStateContext)
  if (!value) {
    throw new Error(
      `useMobileAppState must be used inside MobileAppStateProvider`
    )
  }
  return value
}
