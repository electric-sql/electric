import type { EntityTags, TagOperation } from './tags'
import { ELECTRIC_PRINCIPAL_HEADER } from './headers'
import { appendPathToUrl } from './url'
import type { ClaimTokenHeader, HeadersProvider } from './types'

export interface RuntimeServerClientConfig {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  headers?: HeadersProvider
  writeTokenHeader?: ClaimTokenHeader
  track?: <T>(promise: Promise<T>) => Promise<T>
  principalKey?: string
}

export interface RuntimeEntityInfo {
  entityUrl: string
  entityType?: string
  streamPath: string
}

export type RunnerDispatchPolicy = {
  targets: [{ type: `runner`; runnerId: string; subscription_id?: string }]
}

export type WebhookDispatchPolicy = {
  targets: [{ type: `webhook`; url: string; subscription_id?: string }]
}

export type DispatchPolicy = RunnerDispatchPolicy | WebhookDispatchPolicy

export interface SpawnEntityOptions {
  type: string
  id: string
  args?: Record<string, unknown>
  parentUrl?: string
  initialMessage?: unknown
  tags?: Record<string, string>
  dispatch_policy?: DispatchPolicy
  wake?: {
    subscriberUrl: string
    condition:
      | `runFinished`
      | {
          on: `change`
          collections?: Array<string>
          ops?: Array<TagOperation>
        }
    debounceMs?: number
    timeoutMs?: number
    includeResponse?: boolean
  }
}

export interface SendEntityMessageOptions {
  targetUrl: string
  payload: unknown
  type?: string
  afterMs?: number
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
}

export interface RegisterWakeOptions {
  subscriberUrl: string
  sourceUrl: string
  condition:
    | `runFinished`
    | {
        on: `change`
        collections?: Array<string>
        ops?: Array<TagOperation>
      }
  debounceMs?: number
  timeoutMs?: number
  includeResponse?: boolean
  manifestKey?: string
}

export interface RuntimeServerClient {
  sendEntityMessage: (options: SendEntityMessageOptions) => Promise<void>
  spawnEntity: (options: SpawnEntityOptions) => Promise<RuntimeEntityInfo>
  getEntityInfo: (entityUrl: string) => Promise<RuntimeEntityInfo>
  ensureSharedStateStream: (sharedStateId: string) => Promise<string>
  deleteEntity: (entityUrl: string) => Promise<void>
  getSharedStateStreamPath: (sharedStateId: string) => string
  registerWake: (options: RegisterWakeOptions) => Promise<void>
  registerCronSource: (expression: string, timezone?: string) => Promise<string>
  registerEntitiesSource: (tags: EntityTags) => Promise<{
    streamUrl: string
    sourceRef: string
  }>
  upsertCronSchedule: (options: {
    entityUrl: string
    id: string
    expression: string
    timezone?: string
    payload?: unknown
    debounceMs?: number
    timeoutMs?: number
  }) => Promise<{ txid: string }>
  upsertFutureSendSchedule: (options: {
    entityUrl: string
    id: string
    payload: unknown
    targetUrl?: string
    fireAt: string
    messageType?: string
  }) => Promise<{ txid: string }>
  deleteSchedule: (options: {
    entityUrl: string
    id: string
  }) => Promise<{ txid: string }>
  setTag: (
    entityUrl: string,
    key: string,
    value: string,
    writeToken: string
  ) => Promise<void>
  removeTag: (
    entityUrl: string,
    key: string,
    writeToken: string
  ) => Promise<void>
}

interface RuntimeEntityResponse {
  url?: string
  type?: string
  streams?: {
    main?: string
  }
}

interface SpawnConflictResponse {
  error?: {
    details?: {
      entity?: RuntimeEntityResponse
    }
  }
}

export function getSharedStateStreamPath(sharedStateId: string): string {
  return `/_electric/shared-state/${sharedStateId}`
}

function entityRpcPath(entityUrl: string): string {
  return `/_electric/entities${entityUrl}`
}

export function createRuntimeServerClient(
  config: RuntimeServerClientConfig
): RuntimeServerClient {
  const fetchImpl = config.fetch ?? globalThis.fetch

  const resolveHeaders = async (
    initHeaders?: HeadersInit
  ): Promise<Headers> => {
    const baseHeaders =
      typeof config.headers === `function`
        ? await config.headers()
        : config.headers
    const headers = new Headers(baseHeaders)
    new Headers(initHeaders).forEach((value, key) => headers.set(key, value))
    return headers
  }

  const applyTokenHeader = (
    headers: Headers,
    tokenHeader: ClaimTokenHeader,
    token: string
  ): void => {
    if (
      tokenHeader === `authorization` ||
      (tokenHeader === `both` && !headers.has(`authorization`))
    ) {
      headers.set(`authorization`, `Bearer ${token}`)
    }
    if (tokenHeader === `electric-claim-token` || tokenHeader === `both`) {
      headers.set(`electric-claim-token`, token)
    }
  }

  const track = <T>(promise: Promise<T>): Promise<T> => {
    return config.track ? config.track(promise) : promise
  }

  const request = async (
    path: string,
    init?: RequestInit
  ): Promise<Response> => {
    const headers = await resolveHeaders(init?.headers)
    if (config.principalKey) {
      headers.set(ELECTRIC_PRINCIPAL_HEADER, config.principalKey)
    }
    return track(
      fetchImpl(appendPathToUrl(config.baseUrl, path), {
        ...init,
        headers,
      })
    )
  }

  const requireEntityInfo = (
    entity: RuntimeEntityResponse | undefined,
    context: string
  ): RuntimeEntityInfo => {
    const entityUrl = entity?.url
    const streamPath = entity?.streams?.main
    if (!entityUrl || !streamPath) {
      throw new Error(`${context}: missing entity url or main stream path`)
    }

    return {
      entityUrl,
      entityType: entity.type,
      streamPath,
    }
  }

  const readErrorText = async (response: Response): Promise<string> => {
    try {
      const text = await response.text()
      return text || response.statusText
    } catch {
      return response.statusText
    }
  }

  const sendEntityMessage = async ({
    targetUrl,
    payload,
    type,
    afterMs,
    mode,
    position,
  }: SendEntityMessageOptions): Promise<void> => {
    const body: Record<string, unknown> = { payload }
    if (type !== undefined) body.type = type
    if (afterMs !== undefined) body.afterMs = afterMs
    if (mode !== undefined) body.mode = mode
    if (position !== undefined) body.position = position

    const response = await request(`${entityRpcPath(targetUrl)}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(
        `send to ${targetUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  const getEntityInfo = async (
    entityUrl: string
  ): Promise<RuntimeEntityInfo> => {
    const response = await request(entityRpcPath(entityUrl), { method: `GET` })
    if (!response.ok) {
      throw new Error(
        `failed to resolve entity ${entityUrl} (${response.status}): ${await readErrorText(response)}`
      )
    }

    return requireEntityInfo(
      (await response.json()) as RuntimeEntityResponse,
      `failed to resolve entity ${entityUrl}`
    )
  }

  const spawnEntity = async ({
    type,
    id,
    args,
    parentUrl,
    initialMessage,
    tags,
    dispatch_policy,
    wake,
  }: SpawnEntityOptions): Promise<RuntimeEntityInfo> => {
    const body: Record<string, unknown> = {}
    if (args && Object.keys(args).length > 0) body.args = args
    if (parentUrl !== undefined) body.parent = parentUrl
    if (initialMessage !== undefined) body.initialMessage = initialMessage
    if (tags && Object.keys(tags).length > 0) body.tags = tags
    if (dispatch_policy !== undefined) body.dispatch_policy = dispatch_policy
    if (wake !== undefined) body.wake = wake

    const response = await request(`/_electric/entities/${type}/${id}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    })

    let entityInfo: RuntimeEntityInfo
    if (response.ok) {
      entityInfo = requireEntityInfo(
        (await response.json()) as RuntimeEntityResponse,
        `spawn ${type}/${id} returned an invalid entity payload`
      )
    } else if (response.status === 409) {
      let conflictEntity: RuntimeEntityResponse | undefined
      try {
        const conflict = (await response.json()) as SpawnConflictResponse
        conflictEntity = conflict.error?.details?.entity
      } catch {
        conflictEntity = undefined
      }

      entityInfo = conflictEntity
        ? requireEntityInfo(
            conflictEntity,
            `spawn ${type}/${id} conflict response invalid`
          )
        : await getEntityInfo(`/${type}/${id}`)
    } else {
      throw new Error(
        `spawn ${type}/${id} failed (${response.status}): ${await readErrorText(response)}`
      )
    }

    return entityInfo
  }

  const ensureSharedStateStream = async (
    sharedStateId: string
  ): Promise<string> => {
    const streamPath = getSharedStateStreamPath(sharedStateId)
    const response = await request(streamPath, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
    })

    if (!response.ok && response.status !== 409) {
      throw new Error(
        `failed to create shared state ${sharedStateId} (${response.status}): ${await readErrorText(response)}`
      )
    }

    return streamPath
  }

  const deleteEntity = async (entityUrl: string): Promise<void> => {
    const response = await request(entityRpcPath(entityUrl), {
      method: `DELETE`,
    })
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `delete ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  const registerWake = async (options: RegisterWakeOptions): Promise<void> => {
    const response = await request(`/_electric/wake`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(options),
    })
    if (!response.ok) {
      throw new Error(
        `registerWake failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  const registerCronSource = async (
    expression: string,
    timezone?: string
  ): Promise<string> => {
    const response = await request(`/_electric/cron/register`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ expression, timezone }),
    })
    if (!response.ok) {
      throw new Error(
        `registerCronSource failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    const data = (await response.json()) as { streamUrl: string }
    return data.streamUrl
  }

  const registerEntitiesSource = async (
    tags: EntityTags
  ): Promise<{ streamUrl: string; sourceRef: string }> => {
    const response = await request(`/_electric/entities/register`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ tags }),
    })
    if (!response.ok) {
      throw new Error(
        `registerEntitiesSource failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { streamUrl: string; sourceRef: string }
  }

  const upsertCronSchedule = async (options: {
    entityUrl: string
    id: string
    expression: string
    timezone?: string
    payload?: unknown
    debounceMs?: number
    timeoutMs?: number
  }): Promise<{ txid: string }> => {
    const response = await request(
      `${entityRpcPath(options.entityUrl)}/schedules/${encodeURIComponent(options.id)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          scheduleType: `cron`,
          expression: options.expression,
          timezone: options.timezone,
          payload: options.payload,
          debounceMs: options.debounceMs,
          timeoutMs: options.timeoutMs,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `upsertCronSchedule failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { txid: string }
  }

  const upsertFutureSendSchedule = async (options: {
    entityUrl: string
    id: string
    payload: unknown
    targetUrl?: string
    fireAt: string
    messageType?: string
  }): Promise<{ txid: string }> => {
    const response = await request(
      `${entityRpcPath(options.entityUrl)}/schedules/${encodeURIComponent(options.id)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          scheduleType: `future_send`,
          payload: options.payload,
          targetUrl: options.targetUrl,
          fireAt: options.fireAt,
          messageType: options.messageType,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `upsertFutureSendSchedule failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { txid: string }
  }

  const deleteSchedule = async (options: {
    entityUrl: string
    id: string
  }): Promise<{ txid: string }> => {
    const response = await request(
      `${entityRpcPath(options.entityUrl)}/schedules/${encodeURIComponent(options.id)}`,
      {
        method: `DELETE`,
      }
    )
    if (!response.ok) {
      throw new Error(
        `deleteSchedule failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { txid: string }
  }

  const authedRequest = (
    path: string,
    init: RequestInit,
    writeToken: string
  ): Promise<Response> => {
    const headers = new Headers(init.headers)
    applyTokenHeader(
      headers,
      config.writeTokenHeader ?? `authorization`,
      writeToken
    )
    return request(path, { ...init, headers })
  }

  const setTag = async (
    entityUrl: string,
    key: string,
    value: string,
    writeToken: string
  ): Promise<void> => {
    const response = await authedRequest(
      `${entityRpcPath(entityUrl)}/tags/${encodeURIComponent(key)}`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ value }),
      },
      writeToken
    )
    if (!response.ok) {
      throw new Error(
        `setTag ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  const removeTag = async (
    entityUrl: string,
    key: string,
    writeToken: string
  ): Promise<void> => {
    const response = await authedRequest(
      `${entityRpcPath(entityUrl)}/tags/${encodeURIComponent(key)}`,
      {
        method: `DELETE`,
      },
      writeToken
    )
    if (!response.ok) {
      throw new Error(
        `removeTag ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  return {
    sendEntityMessage,
    spawnEntity,
    getEntityInfo,
    ensureSharedStateStream,
    deleteEntity,
    getSharedStateStreamPath,
    registerWake,
    registerCronSource,
    registerEntitiesSource,
    upsertCronSchedule,
    upsertFutureSendSchedule,
    deleteSchedule,
    setTag,
    removeTag,
  }
}
