import { useMemo } from 'react'
import {
  getActivePrincipal,
  getConfiguredActivePrincipal,
} from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import { resolveCurrentPrincipal } from '@electric-ax/agents-server-ui/src/lib/currentPrincipal'
import { userIdFromPrincipal } from '@electric-ax/agents-server-ui/src/lib/principals'
import { useCloudAuth } from './CloudAuthContext'
import { useMobileAppState } from './MobileAppState'
import { getCloudServiceIdFromServerUrl } from './cloudAgentUrls'

export function useCurrentPrincipal(): {
  principal: string
  userId: string | null
} {
  const { state } = useCloudAuth()
  const { serverUrl } = useMobileAppState()
  const principal = resolveCurrentPrincipal({
    activeServerIsCloud:
      serverUrl !== null && getCloudServiceIdFromServerUrl(serverUrl) !== null,
    cloudUserId:
      state.status === `signed-in` && state.userId ? state.userId : null,
    configuredPrincipal: getConfiguredActivePrincipal(),
    fallbackPrincipal: getActivePrincipal(),
  })
  const userId = userIdFromPrincipal(principal)

  return useMemo(() => ({ principal, userId }), [principal, userId])
}
