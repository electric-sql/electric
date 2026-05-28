import { registerActiveServerHeaders } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import { registerActiveBaseUrl } from '@electric-ax/agents-server-ui/src/lib/entity-connection'
import { getCloudServiceIdFromServerUrl } from './cloudAgentUrls'
import { cloudAuth } from './cloudAuth'

/**
 * Bind the agents-server-ui auth-fetch / entity-connection modules to
 * the mobile app's currently-active server URL. For Cloud agent servers
 * (URL is rooted at `/t/<service-id>/v1`), we trade the user's dashboard
 * JWT for a per-service agents token via `cloudAuth.getAgentsToken` and
 * inject `Authorization: Bearer …` on outbound requests. For local servers
 * we just register the base URL.
 *
 * Pass `null` to clear (e.g. on sign-out or server reset).
 *
 * Mirrors what the desktop app does via Electron's
 * `webRequest.onBeforeSendHeaders` — but in user-space, because React
 * Native has no equivalent network interceptor.
 */
export async function prepareServerHeaders(
  serverUrl: string | null
): Promise<void> {
  if (!serverUrl) {
    registerActiveBaseUrl(null)
    registerActiveServerHeaders(null)
    return
  }
  const serviceId = getCloudServiceIdFromServerUrl(serverUrl)
  if (!serviceId) {
    registerActiveBaseUrl(serverUrl)
    registerActiveServerHeaders(null)
    return
  }
  const token = await cloudAuth.getAgentsToken(serviceId)
  registerActiveBaseUrl(serverUrl)
  if (token) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    }
    // Inform agents-server-ui's `resolveSenderPrincipalUrl` who the
    // current user is. Without this, `sendMessage` falls back to
    // `system:dev-local` (since `loadCloudAuthState` is gated on
    // `window.electronAPI` and so returns `null` on React Native) —
    // and the cloud server 400s because the sender doesn't match the
    // authenticated bearer.
    const userId = cloudAuth.getState().userId
    if (userId) headers[`electric-principal`] = `user:${userId}`
    registerActiveServerHeaders({ url: serverUrl, headers })
  } else {
    // Sign-in expired / token exchange failed — keep the base URL
    // registered (so URL-matching still works) but drop any stale
    // headers. Outbound requests will 401, surfacing the failure to
    // the user rather than silently masking it.
    registerActiveServerHeaders(null)
  }
}
