import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as Linking from 'expo-linking'
import {
  cloudAuth,
  getCloudBaseUrl,
  type CloudAuthProvider,
  type CloudAuthState,
} from './cloudAuth'

/**
 * React-side surface for the cloud-auth singleton. Subscribes to state
 * changes in the global `cloudAuth` and exposes the verbs the UI calls
 * (sign in / sign out / open dashboard). The actual OAuth flow lives
 * in `cloudAuth.signIn` — this context is just a thin wrapper so
 * components don't import the singleton directly.
 */

type CloudAuthContextValue = {
  state: CloudAuthState
  signIn: (provider: CloudAuthProvider) => Promise<void>
  signOut: () => Promise<void>
  openDashboard: () => Promise<void>
}

const CloudAuthContext = createContext<CloudAuthContextValue | null>(null)

export function CloudAuthProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactElement {
  const [state, setState] = useState<CloudAuthState>(() => cloudAuth.getState())

  useEffect(() => {
    void cloudAuth.initialize()
    const unsubscribe = cloudAuth.subscribe(setState)
    return unsubscribe
  }, [])

  const value = useMemo<CloudAuthContextValue>(
    () => ({
      state,
      signIn: (provider) => cloudAuth.signIn(provider),
      signOut: () => cloudAuth.signOut(),
      openDashboard: async () => {
        if (cloudAuth.getState().status !== `signed-in`) return
        await Linking.openURL(getCloudBaseUrl())
      },
    }),
    [state]
  )

  return (
    <CloudAuthContext.Provider value={value}>
      {children}
    </CloudAuthContext.Provider>
  )
}

export function useCloudAuth(): CloudAuthContextValue {
  const value = useContext(CloudAuthContext)
  if (!value) {
    throw new Error(`useCloudAuth must be used inside CloudAuthProvider`)
  }
  return value
}
