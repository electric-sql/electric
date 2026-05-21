import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ReactNode } from 'react'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`
const ONBOARDING_DISMISSED_KEY = `electric-agents-mobile.onboarding-dismissed`

type MobileAppState = {
  loading: boolean
  serverUrl: string | null
  saveServerUrl: (next: string) => Promise<void>
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
  const [onboardingDismissed, setOnboardingDismissedState] = useState(false)

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SERVER_URL_KEY),
      AsyncStorage.getItem(ONBOARDING_DISMISSED_KEY),
    ])
      .then(([storedUrl, storedOnboarding]) => {
        setServerUrl(storedUrl)
        setOnboardingDismissedState(storedOnboarding === `true`)
      })
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo<MobileAppState>(
    () => ({
      loading,
      serverUrl,
      saveServerUrl: async (next: string) => {
        await AsyncStorage.setItem(SERVER_URL_KEY, next)
        setServerUrl(next)
      },
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
    [loading, serverUrl, onboardingDismissed]
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
