import { useMemo } from 'react'
import {
  getActivePrincipal,
  getConfiguredActivePrincipal,
} from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import {
  userIdFromPrincipal,
  userPrincipalUrl,
} from '@electric-ax/agents-server-ui/src/lib/principals'
import { useCloudAuth } from './CloudAuthContext'

export function useCurrentPrincipal(): {
  principal: string
  userId: string | null
} {
  const { state } = useCloudAuth()
  const cloudPrincipal =
    state.status === `signed-in` && state.userId
      ? userPrincipalUrl(state.userId)
      : null
  const principal =
    getConfiguredActivePrincipal() ?? cloudPrincipal ?? getActivePrincipal()
  const userId = userIdFromPrincipal(principal)

  return useMemo(() => ({ principal, userId }), [principal, userId])
}
