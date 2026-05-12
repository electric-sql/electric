import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  applyElectricUrlQueryParams,
  electricUrlWithPath,
} from './electric-url.js'
import { resolveDurableStreamsRoutingAdapter } from '../routing/durable-streams-routing-adapter.js'
import type { Agent } from 'undici'
import type { DurableStreamsRoutingAdapter } from '../routing/durable-streams-routing-adapter.js'

export function contentTypeForStaticFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case `.html`:
      return `text/html; charset=utf-8`
    case `.js`:
      return `text/javascript; charset=utf-8`
    case `.css`:
      return `text/css; charset=utf-8`
    case `.json`:
      return `application/json; charset=utf-8`
    case `.svg`:
      return `image/svg+xml`
    case `.png`:
      return `image/png`
    case `.jpg`:
    case `.jpeg`:
      return `image/jpeg`
    case `.ico`:
      return `image/x-icon`
    case `.map`:
      return `application/json; charset=utf-8`
    default:
      return `application/octet-stream`
  }
}

export function cacheControlForAgentUiFile(filePath: string): string {
  return filePath.includes(`${path.sep}assets${path.sep}`)
    ? `public, max-age=31536000, immutable`
    : `no-cache`
}

export function resolveAgentUiPath(
  agentUiDistDir: string,
  relativePath: string
): string {
  const normalized = relativePath.replace(/^\/+/, ``)
  return path.resolve(agentUiDistDir, normalized)
}

export async function pickAgentUiFile(
  agentUiDistDir: string,
  filePath: string,
  fallbackToIndex: boolean
): Promise<string | null> {
  if (isAgentUiPath(agentUiDistDir, filePath) && (await fileExists(filePath))) {
    return filePath
  }

  if (!fallbackToIndex) {
    return null
  }

  const indexPath = path.join(agentUiDistDir, `index.html`)
  if (!(await fileExists(indexPath))) {
    return null
  }
  return indexPath
}

export function isAgentUiPath(
  agentUiDistDir: string,
  filePath: string
): boolean {
  return (
    filePath === agentUiDistDir ||
    filePath.startsWith(`${agentUiDistDir}${path.sep}`)
  )
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

export function buildElectricProxyTarget(options: {
  incomingUrl: URL
  electricUrl: string
  electricSecret?: string
  tenantId: string
}): URL {
  const targetPath = options.incomingUrl.pathname.replace(
    `/_electric/electric`,
    ``
  )
  const target = electricUrlWithPath(options.electricUrl, targetPath)
  options.incomingUrl.searchParams.forEach((value, key) => {
    target.searchParams.append(key, value)
  })
  applyElectricUrlQueryParams(target, options.electricUrl)

  if (targetPath !== `/v1/shape`) {
    return target
  }

  if (options.electricSecret) {
    target.searchParams.set(`secret`, options.electricSecret)
  }

  const table = options.incomingUrl.searchParams.get(`table`)
  if (table === `entities`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","url","type","status","tags","spawn_args","parent","type_revision","inbox_schemas","state_schemas","created_at","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  } else if (table === `entity_types`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","name","description","creation_schema","inbox_schemas","state_schemas","serve_endpoint","revision","created_at","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  }

  return target
}

export async function forwardFetchRequest(options: {
  request: {
    method: string
    url: string
    headers: Headers
  }
  durableStreamsUrl: string
  durableStreamsRouting?: DurableStreamsRoutingAdapter
  serviceId: string
  body?: Uint8Array
  dispatcher?: Agent
  route?: `stream` | `stream-meta`
}): Promise<Response> {
  const routingAdapter = resolveDurableStreamsRoutingAdapter(
    options.durableStreamsRouting
  )
  const routingInput = {
    durableStreamsUrl: options.durableStreamsUrl,
    serviceId: options.serviceId,
    requestUrl: options.request.url,
  }
  const upstreamUrl =
    options.route === `stream-meta`
      ? routingAdapter.streamMetaUrl(routingInput)
      : routingAdapter.streamUrl(routingInput)

  const headers = new Headers(options.request.headers)

  const init: RequestInit & { duplex?: `half`; dispatcher?: Agent } = {
    method: options.request.method,
    headers,
  }
  if (options.body !== undefined) {
    headers.delete(`content-length`)
    init.body = bodyFromBytes(options.body)
    init.duplex = `half`
  }
  if (options.dispatcher) {
    init.dispatcher = options.dispatcher
  }

  return await fetch(upstreamUrl, init as RequestInit)
}

function bodyFromBytes(body: Uint8Array): ArrayBuffer {
  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  ) as ArrayBuffer
}

export function decodeJsonObject(
  body: Uint8Array
): Record<string, unknown> | null {
  if (body.length === 0) return null

  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as unknown
    if (parsed && typeof parsed === `object` && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Not JSON; callers can fall back to raw bytes.
  }

  return null
}

function applyTenantShapeWhere(target: URL, tenantId: string): void {
  const tenantWhere = `tenant_id = ${sqlStringLiteral(tenantId)}`
  const existingWhere = target.searchParams.get(`where`)
  target.searchParams.set(
    `where`,
    existingWhere ? `${tenantWhere} AND (${existingWhere})` : tenantWhere
  )
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}
