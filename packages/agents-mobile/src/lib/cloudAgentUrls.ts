const TENANT_ROUTE_ROOT = `t`
const TENANT_API_VERSION = `v1`

export function cloudAgentServerUrlFromDashboard(
  dashboardBaseUrl: string,
  serviceId: string
): string {
  const dashboardUrl = new URL(dashboardBaseUrl)
  const agentsUrl = new URL(dashboardUrl.toString())
  if (/^dashboard([.-]|$)/.test(dashboardUrl.hostname)) {
    agentsUrl.hostname = dashboardUrl.hostname.replace(
      /^dashboard(?=[.-]|$)/,
      `agents`
    )
  }
  const prefix = agentsUrl.pathname.replace(/\/+$/, ``)
  agentsUrl.pathname = `${prefix}/${TENANT_ROUTE_ROOT}/${encodeURIComponent(serviceId)}/${TENANT_API_VERSION}`
  agentsUrl.search = ``
  agentsUrl.hash = ``
  return agentsUrl.toString()
}

/**
 * Detect a Cloud agent-server URL and return the tenant service id embedded in
 * its canonical `/t/<service-id>/v1` path prefix. Returns `null` for local
 * URLs, invalid URLs, and old query-param routed Cloud URLs.
 */
export function getCloudServiceIdFromServerUrl(
  serverUrl: string
): string | null {
  let parsed: URL
  try {
    parsed = new URL(serverUrl)
  } catch {
    return null
  }

  const segments = parsed.pathname.split(`/`).filter(Boolean)
  for (let index = 0; index <= segments.length - 3; index += 1) {
    if (
      segments[index] !== TENANT_ROUTE_ROOT ||
      segments[index + 2] !== TENANT_API_VERSION
    ) {
      continue
    }

    const encodedServiceId = segments[index + 1]
    if (!encodedServiceId) return null
    try {
      const serviceId = decodeURIComponent(encodedServiceId)
      return serviceId.trim().length > 0 ? serviceId : null
    } catch {
      return null
    }
  }

  return null
}
