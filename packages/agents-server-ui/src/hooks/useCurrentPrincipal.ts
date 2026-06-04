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
import { userIdFromPrincipal, userPrincipalUrl } from '../lib/principals'

export function useCurrentPrincipal(): {
  principal: string
  userId: string | null
} {
  const [cloudPrincipal, setCloudPrincipal] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const sync = (state: CloudAuthState | null): void => {
      if (cancelled) return
      setCloudPrincipal(
        state?.status === `signed-in` && state.userId
          ? userPrincipalUrl(state.userId)
          : null
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

  const principal =
    getConfiguredActivePrincipal() ?? cloudPrincipal ?? getActivePrincipal()
  const userId = userIdFromPrincipal(principal)

  return useMemo(() => ({ principal, userId }), [principal, userId])
}
