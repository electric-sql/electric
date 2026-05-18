import {
  prefixTenantStreamPath,
  stripTenantStreamPrefix,
} from './tenant-stream-paths.js'
import { durableStreamsControlPath } from './durable-streams-control-path.js'

export interface DurableStreamsRoutingInput {
  durableStreamsUrl: string
  serviceId: string
  requestUrl: string
}

export interface DurableStreamsRoutingAdapter {
  streamUrl(input: DurableStreamsRoutingInput): URL
  controlUrl(input: DurableStreamsRoutingInput): URL
  toBackendStreamPath(serviceId: string, streamPath: string): string
  toRuntimeStreamPath(serviceId: string, streamPath: string): string
}

function appendSearch(target: URL, source: URL): URL {
  target.search = source.search
  return target
}

function removeServiceQuery(target: URL): URL {
  target.searchParams.delete(`service`)
  return target
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, ``) || `/`
}

function logicalStreamPathFromRequest(requestUrl: string): {
  incomingUrl: URL
  streamPath: string
} {
  const incomingUrl = new URL(requestUrl, `http://localhost`)
  return {
    incomingUrl,
    streamPath: incomingUrl.pathname,
  }
}

function pathPrefixedStreamRootUrl(input: DurableStreamsRoutingInput): URL {
  const base = new URL(input.durableStreamsUrl)
  const match = /^(.*)\/v1\/stream(?:\/[^/]+)?\/?$/.exec(base.pathname)
  const prefix = match?.[1] || ``
  base.pathname = `${prefix}/v1/stream`
  base.search = ``
  base.hash = ``
  return base
}

function backendStreamUrl(rootUrl: URL, backendStreamPath: string): URL {
  const path = backendStreamPath.replace(/^\/+/, ``)
  const target = new URL(rootUrl)
  target.pathname = `${withoutTrailingSlash(rootUrl.pathname)}/${path}`
  return target
}

function pathPrefixedControlUrl(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  const controlPath = durableStreamsControlPath(incomingUrl.pathname)
  if (!controlPath)
    return removeServiceQuery(appendSearch(incomingUrl, incomingUrl))
  const root = pathPrefixedStreamRootUrl(input)
  root.pathname = `${withoutTrailingSlash(root.pathname)}${controlPath}`
  return removeServiceQuery(appendSearch(root, incomingUrl))
}

function isElectricCloudUrl(url: URL): boolean {
  return url.hostname === `api.electric-sql.cloud`
}

function tenantRootStreamRootUrl(input: DurableStreamsRoutingInput): URL {
  const base = new URL(input.durableStreamsUrl)
  const path = withoutTrailingSlash(base.pathname)
  const encodedServiceId = encodeURIComponent(input.serviceId)
  if (/\/v1\/streams\/[^/]+$/.test(path)) {
    base.pathname = path
  } else if (path.endsWith(`/v1/streams`)) {
    base.pathname = `${path}/${encodedServiceId}`
  } else if (isElectricCloudUrl(base)) {
    base.pathname = `/v1/streams/${encodedServiceId}`
  } else {
    base.pathname = `${path === `/` ? `` : path}/v1/streams/${encodedServiceId}`
  }
  base.search = ``
  base.hash = ``
  return base
}

function tenantRootBackendUrl(rootUrl: URL, streamPath: string): URL {
  const normalized = streamPath.replace(/^\/+/, ``)
  const target = new URL(rootUrl)
  target.pathname = normalized
    ? `${withoutTrailingSlash(rootUrl.pathname)}/${normalized}`
    : withoutTrailingSlash(rootUrl.pathname)
  return target
}

function tenantRootControlUrl(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  const controlPath = durableStreamsControlPath(incomingUrl.pathname)
  if (!controlPath)
    return removeServiceQuery(appendSearch(incomingUrl, incomingUrl))
  const root = tenantRootStreamRootUrl(input)
  root.pathname = `${withoutTrailingSlash(root.pathname)}${controlPath}`
  return removeServiceQuery(appendSearch(root, incomingUrl))
}

export const pathPrefixedSingleTenantDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl(input) {
      const { incomingUrl, streamPath } = logicalStreamPathFromRequest(
        input.requestUrl
      )
      const target = backendStreamUrl(
        pathPrefixedStreamRootUrl(input),
        prefixTenantStreamPath(streamPath, input.serviceId)
      )
      return removeServiceQuery(appendSearch(target, incomingUrl))
    },

    controlUrl: pathPrefixedControlUrl,

    toBackendStreamPath(serviceId, streamPath) {
      return prefixTenantStreamPath(streamPath, serviceId)
    },

    toRuntimeStreamPath(serviceId, streamPath) {
      return stripTenantStreamPrefix(streamPath, serviceId)
    },
  }

export const tenantRootDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl(input) {
      const { incomingUrl, streamPath } = logicalStreamPathFromRequest(
        input.requestUrl
      )
      const target = tenantRootBackendUrl(
        tenantRootStreamRootUrl(input),
        streamPath
      )
      return removeServiceQuery(appendSearch(target, incomingUrl))
    },

    controlUrl: tenantRootControlUrl,

    toBackendStreamPath(_serviceId, streamPath) {
      return streamPath.replace(/^\/+/, ``)
    },

    toRuntimeStreamPath(_serviceId, streamPath) {
      return streamPath.replace(/^\/+/, ``)
    },
  }

export function resolveDurableStreamsRoutingAdapter(
  adapter?: DurableStreamsRoutingAdapter,
  durableStreamsUrl?: string
): DurableStreamsRoutingAdapter {
  if (adapter) return adapter
  if (durableStreamsUrl) {
    const url = new URL(durableStreamsUrl)
    if (/\/v1\/streams(?:\/|$)/.test(url.pathname) || isElectricCloudUrl(url)) {
      return tenantRootDurableStreamsRoutingAdapter
    }
  }
  return pathPrefixedSingleTenantDurableStreamsRoutingAdapter
}
