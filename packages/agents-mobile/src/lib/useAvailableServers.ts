import { useMemo } from 'react'
import { cloudAgentServerUrl, useCloudAgentServers } from './cloudAgentServers'
import { useMobileAppState } from './MobileAppState'
import { useSavedServers } from './savedServers'
import { mergeAvailableServers } from './availableServers'

export type { AvailableServer, AvailableServerKind } from './availableServers'

/**
 * Merges the persisted server list (`savedServers`) with the live Cloud
 * agent servers the signed-in user can see (`useCloudAgentServers`) into
 * one deduped list for the unified server picker in `HomeMenu`. See
 * `availableServers.ts` for the pure merge logic.
 */
export function useAvailableServers() {
  const saved = useSavedServers()
  const { servers: cloudServers } = useCloudAgentServers()
  const { serverUrl } = useMobileAppState()
  return useMemo(
    () =>
      mergeAvailableServers(
        saved,
        cloudServers,
        serverUrl,
        cloudAgentServerUrl
      ),
    [saved, cloudServers, serverUrl, cloudAgentServerUrl]
  )
}
