const TENANT_ROUTE_ROOT = `/t`
const TENANT_API_VERSION = `v1`
const TENANT_ROUTING_QUERY_PARAMS = [`service`, `tenant`, `tenant_id`]

export function appendPathToUrl(baseUrl: string, path: string): string {
  const base = normalizeAgentServerBaseUrl(baseUrl)
  const pathUrl = new URL(path, `http://electric-agents.local`)
  const basePath =
    base.pathname === `/` ? `` : base.pathname.replace(/\/+$/, ``)
  const suffix = pathUrl.pathname.startsWith(`/`)
    ? pathUrl.pathname
    : `/${pathUrl.pathname}`
  const target = new URL(base)

  target.pathname = `${basePath}${suffix}`
  target.search = ``
  target.hash = pathUrl.hash

  base.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  pathUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })

  return target.toString()
}

function normalizeAgentServerBaseUrl(baseUrl: string): URL {
  const url = new URL(baseUrl)
  const serviceId = tenantRoutingServiceId(url)
  for (const param of TENANT_ROUTING_QUERY_PARAMS) {
    url.searchParams.delete(param)
  }
  if (!serviceId || hasTenantPathPrefix(url.pathname)) {
    return url
  }

  const basePath = url.pathname.replace(/\/+$/, ``)
  url.pathname = `${basePath === `` || basePath === `/` ? `` : basePath}${TENANT_ROUTE_ROOT}/${encodeURIComponent(serviceId)}/${TENANT_API_VERSION}`
  return url
}

function tenantRoutingServiceId(url: URL): string | null {
  for (const param of TENANT_ROUTING_QUERY_PARAMS) {
    const value = url.searchParams.get(param)?.trim()
    if (value) return value
  }
  return null
}

function hasTenantPathPrefix(pathname: string): boolean {
  const segments = pathname.split(`/`).filter(Boolean)
  return segments.some(
    (segment, index) =>
      segment === TENANT_ROUTE_ROOT.slice(1) &&
      Boolean(segments[index + 1]) &&
      segments[index + 2] === TENANT_API_VERSION
  )
}
