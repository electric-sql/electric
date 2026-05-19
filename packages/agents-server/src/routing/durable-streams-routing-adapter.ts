export interface DurableStreamsRoutingInput {
  durableStreamsUrl: string
  requestUrl: string
  /** Tenant identity for external routing adapters; the OSS adapter ignores it. */
  serviceId: string
}

export interface DurableStreamsRoutingAdapter {
  streamUrl(input: DurableStreamsRoutingInput): URL
  controlUrl(input: DurableStreamsRoutingInput): URL
  /**
   * @deprecated Subscription stream paths are logical paths relative to the
   * configured Durable Streams URL. This hook is kept only so existing
   * external routing adapters can continue to typecheck.
   */
  toBackendStreamPath?: (serviceId: string, streamPath: string) => string
  /**
   * @deprecated Subscription stream paths are logical paths relative to the
   * configured Durable Streams URL. This hook is kept only so existing
   * external routing adapters can continue to typecheck.
   */
  toRuntimeStreamPath?: (serviceId: string, streamPath: string) => string
}

function appendSearch(target: URL, source: URL): URL {
  source.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  return target
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, ``) || `/`
}

function appendPath(pathname: string, path: string): string {
  if (!path) return withoutTrailingSlash(pathname)
  const base = withoutTrailingSlash(pathname)
  return base === `/` ? `/${path}` : `${base}/${path}`
}

function appendRequestPathToStreamRoot(input: DurableStreamsRoutingInput): URL {
  const incomingUrl = new URL(input.requestUrl, `http://localhost`)
  const path = incomingUrl.pathname.replace(/^\/+/, ``)
  const target = new URL(input.durableStreamsUrl)
  const basePath = withoutTrailingSlash(target.pathname)
  const requestPath = path ? `/${path}` : `/`

  target.pathname =
    basePath !== `/` &&
    (requestPath === basePath || requestPath.startsWith(`${basePath}/`))
      ? requestPath
      : appendPath(basePath, path)
  return appendSearch(target, incomingUrl)
}

export const streamRootDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl: appendRequestPathToStreamRoot,

    controlUrl: appendRequestPathToStreamRoot,
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
