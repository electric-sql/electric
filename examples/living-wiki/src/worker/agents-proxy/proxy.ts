import { getAgentsRuntimeConfig, type WorkerEnv } from '../env'
import {
  copyAllowedObserveSearchParams,
  copyAllowedRequestHeaders,
  sanitizeProxiedResponseHeaders,
} from './allowlists'
import type { AgentsProxyTarget } from './targets'

export type AgentsProxyFetch = typeof fetch

export class AgentsProxyConfigError extends Error {
  constructor(message = `Agents proxy upstream is not configured`) {
    super(message)
    this.name = `AgentsProxyConfigError`
  }
}

export class AgentsProxyAdapterError extends Error {
  constructor(message: string) {
    super(message)
    this.name = `AgentsProxyAdapterError`
  }
}

type ProxyAgentsStreamRequestOptions = {
  request: Request
  env: WorkerEnv
  target: AgentsProxyTarget
  fetchImpl?: AgentsProxyFetch
}

type RuntimeContext = {
  baseUrl: string
  env: WorkerEnv
  fetchImpl: AgentsProxyFetch
}

export async function proxyAgentsStreamRequest({
  request,
  env,
  target,
  fetchImpl = fetch,
}: ProxyAgentsStreamRequestOptions): Promise<Response> {
  const context = getRuntimeContext(env, fetchImpl)

  switch (target.kind) {
    case `shared-state-observe`:
      return proxyResolvedStreamWithContext({
        request,
        context,
        streamPath: target.streamPath,
      })
    case `entity-main-stream-via-metadata`: {
      const streamPath = await lookupEntityMainStreamPath(
        context,
        target.metadataPath
      )
      return proxyResolvedStreamWithContext({ request, context, streamPath })
    }
    case `entities-observe-via-ensure`: {
      const streamPath = await ensureEntitiesObservationStream({
        context,
        ensurePath: target.ensurePath,
        ensureBody: target.ensureBody,
      })
      return proxyResolvedStreamWithContext({ request, context, streamPath })
    }
  }
}

export async function proxyAgentsResolvedStreamRequest({
  request,
  env,
  streamPath,
  fetchImpl = fetch,
}: {
  request: Request
  env: WorkerEnv
  streamPath: string
  fetchImpl?: AgentsProxyFetch
}): Promise<Response> {
  return proxyResolvedStreamWithContext({
    request,
    context: getRuntimeContext(env, fetchImpl),
    streamPath,
  })
}

async function proxyResolvedStreamWithContext({
  request,
  context,
  streamPath,
}: {
  request: Request
  context: RuntimeContext
  streamPath: string
}): Promise<Response> {
  const upstreamResponse = await context.fetchImpl(
    buildStreamUrl(context.baseUrl, streamPath, request),
    {
      method: `GET`,
      headers: buildUpstreamHeaders(request.headers, context.env),
    }
  )

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: sanitizeProxiedResponseHeaders(upstreamResponse.headers, {
      exposeCorsHeaders: true,
    }),
  })
}

export async function ensureEntitiesObservationStream({
  env,
  target,
  fetchImpl = fetch,
  context,
  ensurePath,
  ensureBody,
}: {
  env?: WorkerEnv
  target?: Extract<AgentsProxyTarget, { kind: `entities-observe-via-ensure` }>
  fetchImpl?: AgentsProxyFetch
  context?: RuntimeContext
  ensurePath?: string
  ensureBody?: unknown
}): Promise<string> {
  const runtime = context ?? getRuntimeContext(env as WorkerEnv, fetchImpl)
  const path = ensurePath ?? target?.ensurePath
  const body = ensureBody ?? target?.ensureBody
  if (!path || body === undefined)
    throw new AgentsProxyAdapterError(`Invalid entities observation target`)

  const response = await runtime.fetchImpl(
    buildUrl(runtime.baseUrl, path).toString(),
    {
      method: `POST`,
      headers: withJsonHeader(buildUpstreamHeaders(new Headers(), runtime.env)),
      body: JSON.stringify(body),
    }
  )
  const data = await parseUpstreamJson(
    response,
    `Invalid upstream ensure response`
  )
  const streamUrl = readStringProperty(
    data,
    `streamUrl`,
    `Invalid upstream ensure response`
  )
  validateRelativeAbsoluteStreamPath(streamUrl)
  return streamUrl
}

function getRuntimeContext(
  env: WorkerEnv,
  fetchImpl: AgentsProxyFetch
): RuntimeContext {
  try {
    const config = getAgentsRuntimeConfig(env)
    if (!config.configured || !config.baseUrl) {
      throw new AgentsProxyConfigError()
    }
    return { baseUrl: config.baseUrl, env, fetchImpl }
  } catch (error) {
    if (error instanceof AgentsProxyConfigError) throw error
    throw new AgentsProxyConfigError(
      `Invalid Agents proxy upstream configuration`
    )
  }
}

async function lookupEntityMainStreamPath(
  context: RuntimeContext,
  metadataPath: string
): Promise<string> {
  const response = await context.fetchImpl(
    buildUrl(context.baseUrl, metadataPath).toString(),
    {
      method: `GET`,
      headers: buildUpstreamHeaders(new Headers(), context.env),
    }
  )
  const data = await parseUpstreamJson(
    response,
    `Invalid upstream entity metadata response`
  )
  const streams = readRecordProperty(
    data,
    `streams`,
    `Invalid upstream entity metadata response`
  )
  const main = readStringProperty(
    streams,
    `main`,
    `Invalid upstream entity metadata response`
  )
  validateRelativeAbsoluteStreamPath(main)
  return main
}

async function parseUpstreamJson(
  response: Response,
  message: string
): Promise<unknown> {
  if (!response.ok) throw new AgentsProxyAdapterError(message)

  try {
    return await response.json()
  } catch {
    throw new AgentsProxyAdapterError(message)
  }
}

function readRecordProperty(
  value: unknown,
  key: string,
  message: string
): Record<string, unknown> {
  if (typeof value !== `object` || value === null || !(key in value))
    throw new AgentsProxyAdapterError(message)
  const property = (value as Record<string, unknown>)[key]
  if (typeof property !== `object` || property === null)
    throw new AgentsProxyAdapterError(message)
  return property as Record<string, unknown>
}

function readStringProperty(
  value: unknown,
  key: string,
  message: string
): string {
  if (typeof value !== `object` || value === null || !(key in value))
    throw new AgentsProxyAdapterError(message)
  const property = (value as Record<string, unknown>)[key]
  if (typeof property !== `string`) throw new AgentsProxyAdapterError(message)
  return property
}

function buildStreamUrl(
  baseUrl: string,
  streamPath: string,
  request: Request
): string {
  validateRelativeAbsoluteStreamPath(streamPath)
  const upstream = buildUrl(baseUrl, streamPath)
  copyAllowedObserveSearchParams(
    new URL(request.url).searchParams,
    upstream.searchParams
  )
  return upstream.toString()
}

function buildUrl(baseUrl: string, path: string): URL {
  validateRelativeAbsoluteStreamPath(path)
  const upstream = new URL(baseUrl)
  const basePath = upstream.pathname.replace(/\/+$/u, ``)
  upstream.pathname = `${basePath}${path}`
  upstream.search = ``
  upstream.hash = ``
  return upstream
}

function validateRelativeAbsoluteStreamPath(path: string): void {
  if (
    !path.startsWith(`/`) ||
    path.startsWith(`//`) ||
    /^https?:\/\//i.test(path)
  ) {
    throw new AgentsProxyAdapterError(`Invalid upstream stream path`)
  }

  let parsed: URL
  try {
    parsed = new URL(path, `https://agents-proxy.invalid`)
  } catch {
    throw new AgentsProxyAdapterError(`Invalid upstream stream path`)
  }

  if (
    parsed.origin !== `https://agents-proxy.invalid` ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new AgentsProxyAdapterError(`Invalid upstream stream path`)
  }

  for (const segment of path.split(`/`)) {
    let decodedSegment = segment
    for (let i = 0; i < 3; i += 1) {
      try {
        const next = decodeURIComponent(decodedSegment)
        if (next === decodedSegment) break
        decodedSegment = next
      } catch {
        throw new AgentsProxyAdapterError(`Invalid upstream stream path`)
      }
    }
    if (decodedSegment === `.` || decodedSegment === `..`) {
      throw new AgentsProxyAdapterError(`Invalid upstream stream path`)
    }
  }
}

function buildUpstreamHeaders(from: Headers, env: WorkerEnv): Headers {
  const headers = copyAllowedRequestHeaders(from)
  if (env.ELECTRIC_AGENTS_TOKEN) {
    // Agents discovery did not prove a universal token header; use explicit Bearer auth and never forward browser auth.
    headers.set(`authorization`, `Bearer ${env.ELECTRIC_AGENTS_TOKEN}`)
  }
  if (env.ELECTRIC_AGENTS_PRINCIPAL_KEY) {
    headers.set(`electric-principal`, env.ELECTRIC_AGENTS_PRINCIPAL_KEY)
  }
  return headers
}

function withJsonHeader(headers: Headers): Headers {
  headers.set(`content-type`, `application/json`)
  return headers
}
