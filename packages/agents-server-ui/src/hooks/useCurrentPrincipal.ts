import { useEffect, useMemo, useState } from 'react'
import {
  getActivePrincipal,
  getConfiguredActivePrincipal,
} from '../lib/auth-fetch'
import {
  loadCloudAuthState,
  onCloudAuthStateChanged,
  type CloudAuthState,
} from '../lib/server-connection'
import { userIdFromPrincipal } from '../lib/principals'
import { resolveCurrentPrincipal } from '../lib/currentPrincipal'
import { useOptionalServerConnection } from './useServerConnection'

export function useCurrentPrincipal(): {
  principal: string
  userId: string | null
} {
  const serverConnection = useOptionalServerConnection()
  const [cloudUserId, setCloudUserId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const sync = (state: CloudAuthState | null): void => {
      if (cancelled) return
      setCloudUserId(
        state?.status === `signed-in` && state.userId ? state.userId : null
      )
    }

    void loadCloudAuthState()
      .then(sync)
      .catch(() => sync(null))
    const unsubscribe = onCloudAuthStateChanged(sync)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const principal = resolveCurrentPrincipal({
    activeServerIsCloud:
      serverConnection?.activeServer?.source === `electric-cloud`,
    cloudUserId,
    configuredPrincipal: getConfiguredActivePrincipal(),
    fallbackPrincipal: getActivePrincipal(),
  })
  const userId = userIdFromPrincipal(principal)

  return useMemo(() => ({ principal, userId }), [principal, userId])
}
