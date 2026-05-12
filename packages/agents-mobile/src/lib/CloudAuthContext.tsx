import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as Linking from 'expo-linking'
import {
  cloudAuth,
  getCloudBaseUrl,
  type CloudAuthCallbackResult,
  type CloudAuthProvider,
  type CloudAuthState,
} from './cloudAuth'

/**
 * React-side surface for the cloud-auth singleton. Subscribes to state
 * changes in the global `cloudAuth` and exposes the verbs the UI calls
 * (start sign-in / complete sign-in / cancel / sign out / open
 * dashboard). The actual OAuth interception lives in the WebView screen
 * — this context is just a thin wrapper.
 */

type CloudAuthContextValue = {
  state: CloudAuthState
  beginSignIn: (provider: CloudAuthProvider) => void
  cancelSignIn: () => void
  reportSignInError: (message: string) => void
  completeSignIn: (result: CloudAuthCallbackResult) => Promise<void>
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
      beginSignIn: (provider) => cloudAuth.beginSignIn(provider),
      cancelSignIn: () => cloudAuth.cancelSignIn(),
      reportSignInError: (message) => cloudAuth.reportSignInError(message),
      completeSignIn: (result) => cloudAuth.completeSignIn(result),
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
