export interface DurableStreamsRoutingInput {
  durableStreamsUrl: string
  serviceId: string
  requestUrl: string
}

export interface DurableStreamsRoutingAdapter {
  streamUrl(input: DurableStreamsRoutingInput): URL
  controlUrl(input: DurableStreamsRoutingInput): URL
  /**
   * Map a runtime-namespace stream path to the backend (durable-streams
   * worker) namespace under which it is stored / keyed.
   *
   * **Required to be idempotent:** if `streamPath` is already in the backend
   * namespace, the implementation MUST return it unchanged. Subscription
   * payloads round-trip through `toBackendStreamPath` whenever they are
   * written or refreshed, so an adapter that unconditionally prefixes will
   * cause runaway double-prefixing across `getSubscription` →
   * `addSubscriptionStreams` cycles.
   *
   * Implementations should also be deterministic, side-effect free, and must
   * not throw — exceptions surface inside subscription ack / release paths
   * where they can cause re-dispatch storms.
   */
  toBackendStreamPath(serviceId: string, streamPath: string): string
  /**
   * Inverse of `toBackendStreamPath`. Strip the backend transform so callers
   * can reason in the runtime namespace. Must be idempotent for paths
   * already in the runtime namespace.
   */
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

export const streamRootDurableStreamsRoutingAdapter: DurableStreamsRoutingAdapter =
  {
    streamUrl: appendRequestPathToStreamRoot,

    controlUrl: appendRequestPathToStreamRoot,

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
