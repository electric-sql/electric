import { registerActiveServerHeaders } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import { registerActiveBaseUrl } from '@electric-ax/agents-server-ui/src/lib/entity-connection'
import { cloudAuth, getCloudServiceIdFromServerUrl } from './cloudAuth'

/**
 * Bind the agents-server-ui auth-fetch / entity-connection modules to
 * the mobile app's currently-active server URL. For Cloud agent servers
 * (URL carries `?service=<id>`), we trade the user's dashboard JWT for
 * a per-service agents token via `cloudAuth.getAgentsToken` and inject
 * `Authorization: Bearer …` + `x-electric-service: <id>` on outbound
 * requests. For local servers we just register the base URL.
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
    registerActiveServerHeaders({
      url: serverUrl,
      headers: {
        authorization: `Bearer ${token}`,
        'x-electric-service': serviceId,
      },
    })
  } else {
    // Sign-in expired / token exchange failed — keep the base URL
    // registered (so URL-matching still works) but drop any stale
    // headers. Outbound requests will 401, surfacing the failure to
    // the user rather than silently masking it.
    registerActiveServerHeaders(null)
  }
}
