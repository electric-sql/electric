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
  source.searchParams.forEach((value, key) => {
    if (key !== `service`) {
      target.searchParams.append(key, value)
    }
  })
  return target
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, ``) || `/`
}

function appendRequestPathToStreamRoot(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  const path = incomingUrl.pathname.replace(/^\/+/, ``)
  const target = new URL(input.durableStreamsUrl)
  target.pathname = path
    ? `${withoutTrailingSlash(target.pathname)}/${path}`
    : withoutTrailingSlash(target.pathname)
  return appendSearch(target, incomingUrl)
}

function appendControlPathToBackend(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  if (!incomingUrl.pathname.startsWith(`/__ds/subscriptions`)) {
    return appendRequestPathToStreamRoot(input)
  }
  const match = /^(.*)\/v1\/stream(?:\/(.+))?\/?$/.exec(
    new URL(input.durableStreamsUrl).pathname
  )
  if (!match) {
    return appendRequestPathToStreamRoot(input)
  }

  const [, prefix = ``, serviceId] = match
  const target = new URL(input.durableStreamsUrl)
  target.pathname = `${prefix}/v1/stream-meta${incomingUrl.pathname.replace(/^\/__ds/, ``)}`
  appendSearch(target, incomingUrl)
  if (serviceId) {
    target.searchParams.set(`service`, decodeURIComponent(serviceId))
  }
  return target
}

export const streamRootDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl: appendRequestPathToStreamRoot,

    controlUrl: appendControlPathToBackend,

    toBackendStreamPath(_serviceId, streamPath) {
      return streamPath.replace(/^\/+/, ``)
    },

    toRuntimeStreamPath(_serviceId, streamPath) {
      return streamPath.replace(/^\/+/, ``)
    },
  }

export const pathPrefixedSingleTenantDurableStreamsRoutingAdapter =
  streamRootDurableStreamsRoutingAdapter

export const tenantRootDurableStreamsRoutingAdapter =
  streamRootDurableStreamsRoutingAdapter

export function resolveDurableStreamsRoutingAdapter(
  adapter?: DurableStreamsRoutingAdapter,
  _durableStreamsUrl?: string
): DurableStreamsRoutingAdapter {
  return adapter ?? streamRootDurableStreamsRoutingAdapter
}
