import {
  prefixTenantStreamPath,
  stripTenantStreamPrefix,
} from './tenant-stream-paths.js'

export interface DurableStreamsRoutingInput {
  durableStreamsUrl: string
  serviceId: string
  requestUrl: string
}

export interface DurableStreamsRoutingAdapter {
  streamUrl(input: DurableStreamsRoutingInput): URL
  streamMetaUrl(input: DurableStreamsRoutingInput): URL
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

function logicalStreamPathFromRequest(
  requestUrl: string,
  serviceId: string
): { incomingUrl: URL; streamPath: string } {
  const incomingUrl = new URL(requestUrl, `http://localhost`)
  const segments = incomingUrl.pathname.split(`/`).filter(Boolean)
  if (segments[0] === `v1` && segments[1] === `stream`) {
    return {
      incomingUrl,
      streamPath: segments.length > 2 ? `/${segments.slice(3).join(`/`)}` : `/`,
    }
  }

  return {
    incomingUrl,
    streamPath: incomingUrl.pathname || `/${serviceId}`,
  }
}

function backendStreamUrl(
  input: DurableStreamsRoutingInput,
  backendStreamPath: string
): URL {
  const path = backendStreamPath.replace(/^\/+/, ``)
  const target = new URL(`/v1/stream/${path}`, input.durableStreamsUrl)
  return target
}

function streamMetaUrlWithoutService(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  return removeServiceQuery(
    appendSearch(
      new URL(incomingUrl.pathname, input.durableStreamsUrl),
      incomingUrl
    )
  )
}

export const pathPrefixedSingleTenantDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl(input) {
      const { incomingUrl, streamPath } = logicalStreamPathFromRequest(
        input.requestUrl,
        input.serviceId
      )
      const target = backendStreamUrl(
        input,
        prefixTenantStreamPath(streamPath, input.serviceId)
      )
      return removeServiceQuery(appendSearch(target, incomingUrl))
    },

    streamMetaUrl: streamMetaUrlWithoutService,

    toBackendStreamPath(serviceId, streamPath) {
      return prefixTenantStreamPath(streamPath, serviceId)
    },

    toRuntimeStreamPath(serviceId, streamPath) {
      return stripTenantStreamPrefix(streamPath, serviceId)
    },
  }

export function resolveDurableStreamsRoutingAdapter(
  adapter?: DurableStreamsRoutingAdapter
): DurableStreamsRoutingAdapter {
  return adapter ?? pathPrefixedSingleTenantDurableStreamsRoutingAdapter
}
