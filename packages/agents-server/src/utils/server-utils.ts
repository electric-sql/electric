import { access } from 'node:fs/promises'
import path from 'node:path'
import {
  applyElectricUrlQueryParams,
  electricUrlWithPath,
} from './electric-url.js'
import { resolveDurableStreamsRoutingAdapter } from '../routing/durable-streams-routing-adapter.js'
import { applyDurableStreamsBearer } from '../stream-client.js'
import type { Agent } from 'undici'
import type { DurableStreamsRoutingAdapter } from '../routing/durable-streams-routing-adapter.js'
import type { DurableStreamsBearerProvider } from '../stream-client.js'

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
  principalUrl?: string
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
      `"tenant_id","url","type","status","dispatch_policy","tags","spawn_args","parent","type_revision","inbox_schemas","state_schemas","created_at","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  } else if (table === `entity_types`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","name","description","creation_schema","inbox_schemas","state_schemas","serve_endpoint","default_dispatch_policy","revision","created_at","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  } else if (table === `runners`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","id","owner_principal","label","kind","admin_status","wake_stream","created_at","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId, [
      `owner_principal = ${sqlStringLiteral(options.principalUrl ?? ``)}`,
    ])
  } else if (table === `runner_runtime_diagnostics`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","runner_id","owner_principal","wake_stream_offset","last_seen_at","liveness_lease_expires_at","diagnostics","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId, [
      `owner_principal = ${sqlStringLiteral(options.principalUrl ?? ``)}`,
    ])
  } else if (table === `entity_dispatch_state`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","entity_url","pending_source_streams","pending_reason","pending_since","outstanding_wake_id","outstanding_wake_target","outstanding_wake_created_at","active_consumer_id","active_runner_id","active_epoch","active_claimed_at","active_lease_expires_at","last_wake_id","last_claimed_at","last_released_at","last_completed_at","last_error","updated_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  } else if (table === `wake_notifications`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","wake_id","entity_url","target_type","target_runner_id","target_webhook_url","target_worker_pool_id","runner_wake_stream","runner_wake_stream_offset","notification_public","delivery_status","claim_status","created_at","delivered_at","claimed_at","resolved_at"`
    )
    applyTenantShapeWhere(target, options.tenantId)
  } else if (table === `consumer_claims`) {
    target.searchParams.set(
      `columns`,
      `"tenant_id","consumer_id","epoch","wake_id","entity_url","stream_path","runner_id","status","claimed_at","last_heartbeat_at","lease_expires_at","released_at","acked_streams","updated_at"`
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
  route?: `stream` | `control`
  durableStreamsBearer?: DurableStreamsBearerProvider
  durableStreamsBearerMode?: `overwrite` | `if-missing` | `none`
}): Promise<Response> {
  const routingAdapter = resolveDurableStreamsRoutingAdapter(
    options.durableStreamsRouting,
    options.durableStreamsUrl
  )
  const routingInput = {
    durableStreamsUrl: options.durableStreamsUrl,
    serviceId: options.serviceId,
    requestUrl: options.request.url,
  }
  const upstreamUrl =
    options.route === `control`
      ? routingAdapter.controlUrl(routingInput)
      : routingAdapter.streamUrl(routingInput)

  const headers = new Headers(options.request.headers)
  if (options.durableStreamsBearerMode !== `none`) {
    await applyDurableStreamsBearer(headers, options.durableStreamsBearer, {
      overwrite: options.durableStreamsBearerMode !== `if-missing`,
    })
  }

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

function applyTenantShapeWhere(
  target: URL,
  tenantId: string,
  extraConditions: Array<string> = []
): void {
  const tenantWhere = [
    `tenant_id = ${sqlStringLiteral(tenantId)}`,
    ...extraConditions,
  ].join(` AND `)
  const existingWhere = target.searchParams.get(`where`)
  target.searchParams.set(
    `where`,
    existingWhere ? `${tenantWhere} AND (${existingWhere})` : tenantWhere
  )
}

function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, `''`)}'`
}
