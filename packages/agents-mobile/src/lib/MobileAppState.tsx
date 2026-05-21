import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ReactNode } from 'react'

const SERVER_URL_KEY = `electric-agents-mobile.server-url`

type MobileAppState = {
  loading: boolean
  serverUrl: string | null
  saveServerUrl: (next: string) => Promise<void>
}

const MobileAppStateContext = createContext<MobileAppState | null>(null)

export function MobileAppStateProvider({
  children,
}: {
  children: ReactNode
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [serverUrl, setServerUrl] = useState<string | null>(null)

  useEffect(() => {
    AsyncStorage.getItem(SERVER_URL_KEY)
      .then((stored) => setServerUrl(stored))
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
    }),
    [loading, serverUrl]
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
