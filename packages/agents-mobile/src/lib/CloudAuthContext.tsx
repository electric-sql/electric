import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import * as Linking from 'expo-linking'
import {
  cloudAuth,
  devWarn,
  getCloudBaseUrl,
  isCallbackUrl,
  type CloudAuthProvider,
  type CloudAuthState,
} from './cloudAuth'

/**
 * React-side surface for the cloud-auth singleton. Subscribes to state
 * changes in the global `cloudAuth` and exposes the verbs the UI calls
 * (sign in / sign out / open dashboard). The actual OAuth flow lives
 * in `cloudAuth.signIn` — this context is just a thin wrapper so
 * components don't import the singleton directly.
 *
 * The provider also owns the **global deep-link listener** for the
 * OAuth redirect (`electric-agents://oauth/callback?...`). Doing this
 * at the app level instead of only inside the `/oauth/callback` route
 * means the redirect is consumed even when Expo Router doesn't
 * navigate us there (which happens regularly on Android cold starts,
 * where the OS relaunches the app via the redirect intent but the
 * router has not had a chance to attach its own listeners yet).
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

  useEffect(() => {
    // Two channels deliver the OAuth redirect, depending on whether
    // the app was already running:
    //   1. `addEventListener('url')` — warm start: existing JS context
    //      receives the new intent.
    //   2. `getInitialURL()` — cold start: the app was launched (or
    //      relaunched after being killed) by the redirect intent
    //      itself, so the URL is on the initial activity's intent
    //      rather than coming through the listener.
    // We wire up both and let `cloudAuth` deduplicate via
    // `completingUrl`.
    const subscription = Linking.addEventListener(`url`, ({ url }) => {
      if (!isCallbackUrl(url)) return
      void cloudAuth.handleDeepLink(url)
    })
    void Linking.getInitialURL()
      .then((url) => {
        if (url && isCallbackUrl(url)) {
          void cloudAuth.handleDeepLink(url)
        }
      })
      .catch((err) => {
        devWarn(`[agents-mobile] cloud-auth getInitialURL failed:`, err)
      })
    return () => subscription.remove()
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
