export const AGENTS_OBSERVE_PROTOCOL_QUERY_PARAMS = [
  `offset`,
  `live`,
  `cursor`,
] as const

export const AGENTS_OBSERVE_LIVE_VALUES = [`long-poll`] as const

export const AGENTS_REQUEST_HEADER_ALLOWLIST = [] as readonly string[]

export const AGENTS_RESPONSE_HEADER_EXPOSE_ALLOWLIST = [
  `Stream-Next-Offset`,
  `Stream-Cursor`,
  `Stream-Up-To-Date`,
  `Stream-Closed`,
  `stream-sse-data-encoding`,
] as const

type AgentsObserveProtocolQueryParam =
  (typeof AGENTS_OBSERVE_PROTOCOL_QUERY_PARAMS)[number]
type AgentsObserveLiveValue = (typeof AGENTS_OBSERVE_LIVE_VALUES)[number]

const observeProtocolQueryParams = new Set<string>(
  AGENTS_OBSERVE_PROTOCOL_QUERY_PARAMS
)
const observeLiveValues = new Set<string>(AGENTS_OBSERVE_LIVE_VALUES)
const requestHeaderAllowlist = new Set<string>(
  AGENTS_REQUEST_HEADER_ALLOWLIST.map((header) => header.toLowerCase())
)

const isAgentsObserveProtocolQueryParam = (
  key: string
): key is AgentsObserveProtocolQueryParam => observeProtocolQueryParams.has(key)

const isAllowedLiveValue = (value: string): value is AgentsObserveLiveValue =>
  observeLiveValues.has(value)

export function copyAllowedObserveSearchParams(
  from: URLSearchParams,
  to: URLSearchParams
): void {
  for (const key of AGENTS_OBSERVE_PROTOCOL_QUERY_PARAMS) {
    const value = from.get(key)
    if (value === null) {
      continue
    }

    if (!isAgentsObserveProtocolQueryParam(key)) {
      continue
    }

    if (key === `live` && !isAllowedLiveValue(value)) {
      continue
    }

    to.set(key, value)
  }
}

export function copyAllowedRequestHeaders(from: Headers): Headers {
  const headers = new Headers()

  for (const [key, value] of from.entries()) {
    if (requestHeaderAllowlist.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  return headers
}

export function sanitizeProxiedResponseHeaders(
  headers: Headers,
  options: { exposeCorsHeaders?: boolean } = {}
): Headers {
  const sanitized = new Headers(headers)

  sanitized.delete(`content-encoding`)
  sanitized.delete(`content-length`)

  if (options.exposeCorsHeaders) {
    sanitized.set(
      `Access-Control-Expose-Headers`,
      AGENTS_RESPONSE_HEADER_EXPOSE_ALLOWLIST.join(`, `)
    )
  }

  return sanitized
}
