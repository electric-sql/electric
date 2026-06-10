import type {
  PgSyncOptions,
  PgSyncRequestMetadata,
} from './observation-sources'
import type { EntityTags, TagOperation } from './tags'
import { appendPathToUrl } from './url'
import { buildEventSourceSubscriptionId } from './event-sources'
import type {
  AttachmentCreateInput,
  ClaimTokenHeader,
  HeadersProvider,
  ManifestAttachmentEntry,
} from './types'
import type { EntitySignal } from './entity-schema'
import type {
  EventSourceContract,
  EventSourceSubscription,
  EventSourceSubscriptionInput,
} from './event-sources'
export type { EntitySignal } from './entity-schema'

const ELECTRIC_PRINCIPAL_HEADER = `electric-principal`

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
  initialMessageType?: string
  tags?: Record<string, string>
  /**
   * Sandbox selection — a `profile` with optional `scope` / `persistent`, an
   * explicit shared `key`, or `inherit` the parent's resolved sandbox.
   */
  sandbox?: {
    profile?: string
    key?: string
    scope?: `entity` | `wake`
    persistent?: boolean
    owner?: boolean
    inherit?: boolean
  }
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
    manifestKey?: string
  }
}

export interface SendEntityMessageOptions {
  targetUrl: string
  payload: unknown
  type?: string
  afterMs?: number
  mode?: `immediate` | `queued` | `paused` | `steer`
  position?: string
  fromPrincipal?: string
  fromAgent?: string
  writeToken?: string
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

export interface SignalEntityOptions {
  entityUrl: string
  signal: EntitySignal
  reason?: string
  payload?: unknown
}

export interface RuntimeServerClient {
  sendEntityMessage: (options: SendEntityMessageOptions) => Promise<void>
  createAttachment: (options: {
    entityUrl: string
    attachment: AttachmentCreateInput
  }) => Promise<{ txid: string; attachment: ManifestAttachmentEntry }>
  readAttachment: (options: {
    entityUrl: string
    id: string
  }) => Promise<Uint8Array>
  spawnEntity: (options: SpawnEntityOptions) => Promise<RuntimeEntityInfo>
  /**
   * Fork an entity at the server-resolved `latest_completed_run` anchor.
   * Resolves to the new root entity's info. Wraps the agents-server
   * `POST /_electric/entities/<type>/<id>/fork` endpoint.
   *
   * Optional fields mirror `spawnEntity`:
   * - `parent` makes the new fork a child of that URL.
   * - `wake` registers a subscription at fork time (reply delivery
   *   uses the parent's manifest-anchored wake when paired with a
   *   manifest entry on the parent — same model as `spawn`).
   * - `initialMessage` folds fork+send into one round-trip. Not
   *   atomic: sent after fork creation and dispatch linking, so a
   *   partial failure can leave an idle dispatched fork.
   * - `tags` stamps tags onto the new fork in addition to those
   *   copied from the source.
   */
  forkEntity: (options: {
    sourceEntityUrl: string
    /** Maps to the server's `instance_id` body field. */
    instanceId?: string
    parent?: string
    wake?: {
      subscriberUrl: string
      condition: RegisterWakeOptions[`condition`]
      debounceMs?: number
      timeoutMs?: number
      includeResponse?: boolean
      manifestKey?: string
    }
    initialMessage?: unknown
    tags?: Record<string, string>
  }) => Promise<RuntimeEntityInfo>
  getEntity: (entityUrl: string) => Promise<RuntimeEntityInfo>
  ensureSharedStateStream: (
    sharedStateId: string,
    ownerEntityUrl?: string
  ) => Promise<string>
  signalEntity: (options: SignalEntityOptions) => Promise<{ txid: number }>
  ensureStream: (streamPath: string, contentType?: string) => Promise<string>
  deleteEntity: (entityUrl: string) => Promise<void>
  getSharedStateStreamPath: (sharedStateId: string) => string
  registerWake: (options: RegisterWakeOptions) => Promise<void>
  ensureCronStream: (expression: string, timezone?: string) => Promise<string>
  ensureEntitiesMembershipStream: (tags: EntityTags) => Promise<{
    streamUrl: string
    sourceRef: string
  }>
  registerPgSyncSource: (
    options: PgSyncOptions,
    metadata?: PgSyncRequestMetadata
  ) => Promise<{
    streamUrl: string
    sourceRef: string
  }>
  listEventSources: () => Promise<Array<EventSourceContract>>
  subscribeToEventSource: (
    options: EventSourceSubscriptionInput & { entityUrl: string }
  ) => Promise<{ txid: string; subscription: EventSourceSubscription }>
  unsubscribeFromEventSource: (options: {
    entityUrl: string
    id: string
  }) => Promise<{ txid: string }>
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
  deleteTag: (
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

function entityRpcPath(entityUrl: string, suffix = ``): string {
  return `/_electric/entities${entityUrl}${suffix}`
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
    fromPrincipal,
    fromAgent,
    writeToken,
  }: SendEntityMessageOptions): Promise<void> => {
    const body: Record<string, unknown> = { payload }
    if (type !== undefined) body.type = type
    if (afterMs !== undefined) body.afterMs = afterMs
    if (mode !== undefined) body.mode = mode
    if (position !== undefined) body.position = position
    if (fromPrincipal !== undefined) body.from_principal = fromPrincipal
    if (fromAgent !== undefined) body.from_agent = fromAgent

    const headers = new Headers({ 'content-type': `application/json` })
    if (writeToken) {
      applyTokenHeader(
        headers,
        config.writeTokenHeader ?? `authorization`,
        writeToken
      )
    }

    const response = await request(`${entityRpcPath(targetUrl)}/send`, {
      method: `POST`,
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(
        `send to ${targetUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  const createAttachment = async ({
    entityUrl,
    attachment,
  }: {
    entityUrl: string
    attachment: AttachmentCreateInput
  }): Promise<{ txid: string; attachment: ManifestAttachmentEntry }> => {
    const form = new FormData()
    let bytes: Blob
    if (attachment.bytes instanceof Blob) {
      bytes = attachment.bytes
    } else if (attachment.bytes instanceof Uint8Array) {
      const copy = new Uint8Array(attachment.bytes.byteLength)
      copy.set(attachment.bytes)
      bytes = new Blob([copy.buffer], {
        type: attachment.mimeType ?? `application/octet-stream`,
      })
    } else {
      bytes = new Blob([attachment.bytes], {
        type: attachment.mimeType ?? `application/octet-stream`,
      })
    }
    form.set(
      `file`,
      bytes,
      attachment.filename && attachment.filename.trim()
        ? attachment.filename
        : `attachment`
    )
    if (attachment.mimeType) form.set(`mimeType`, attachment.mimeType)
    if (attachment.filename) form.set(`filename`, attachment.filename)
    form.set(`subject`, JSON.stringify(attachment.subject))
    form.set(`role`, attachment.role ?? `input`)
    if (attachment.meta) form.set(`meta`, JSON.stringify(attachment.meta))

    const response = await request(`${entityRpcPath(entityUrl)}/attachments`, {
      method: `POST`,
      body: form,
    })

    if (!response.ok) {
      throw new Error(
        `create attachment on ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }

    return (await response.json()) as {
      txid: string
      attachment: ManifestAttachmentEntry
    }
  }

  const readAttachment = async ({
    entityUrl,
    id,
  }: {
    entityUrl: string
    id: string
  }): Promise<Uint8Array> => {
    const response = await request(
      `${entityRpcPath(entityUrl)}/attachments/${encodeURIComponent(id)}`,
      { method: `GET` }
    )
    if (!response.ok) {
      throw new Error(
        `read attachment ${id} on ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return new Uint8Array(await response.arrayBuffer())
  }

  const getEntity = async (entityUrl: string): Promise<RuntimeEntityInfo> => {
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
    initialMessageType,
    tags,
    sandbox,
    dispatch_policy,
    wake,
  }: SpawnEntityOptions): Promise<RuntimeEntityInfo> => {
    const body: Record<string, unknown> = {}
    if (args && Object.keys(args).length > 0) body.args = args
    if (parentUrl !== undefined) body.parent = parentUrl
    if (initialMessage !== undefined) body.initialMessage = initialMessage
    if (initialMessageType !== undefined)
      body.initialMessageType = initialMessageType
    if (tags && Object.keys(tags).length > 0) body.tags = tags
    if (sandbox !== undefined) body.sandbox = sandbox
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
        : await getEntity(`/${type}/${id}`)
    } else {
      throw new Error(
        `spawn ${type}/${id} failed (${response.status}): ${await readErrorText(response)}`
      )
    }

    return entityInfo
  }

  const forkEntity = async ({
    sourceEntityUrl,
    instanceId,
    parent,
    wake,
    initialMessage,
    tags,
  }: {
    sourceEntityUrl: string
    instanceId?: string
    parent?: string
    wake?: {
      subscriberUrl: string
      condition: RegisterWakeOptions[`condition`]
      debounceMs?: number
      timeoutMs?: number
      includeResponse?: boolean
      manifestKey?: string
    }
    initialMessage?: unknown
    tags?: Record<string, string>
  }): Promise<RuntimeEntityInfo> => {
    const body: Record<string, unknown> = {
      anchor: `latest_completed_run`,
    }
    if (instanceId !== undefined) body.instance_id = instanceId
    if (parent !== undefined) body.parent = parent
    if (wake !== undefined) body.wake = wake
    if (initialMessage !== undefined) body.initialMessage = initialMessage
    if (tags !== undefined) body.tags = tags
    const response = await request(entityRpcPath(sourceEntityUrl, `/fork`), {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(
        `fork ${sourceEntityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    const payload = (await response.json()) as { root?: RuntimeEntityResponse }
    return requireEntityInfo(
      payload.root,
      `fork ${sourceEntityUrl} returned an invalid root payload`
    )
  }

  const ensureSharedStateStream = async (
    sharedStateId: string,
    ownerEntityUrl?: string
  ): Promise<string> => {
    const streamPath = getSharedStateStreamPath(sharedStateId)
    return await ensureStream(streamPath, `application/json`, ownerEntityUrl)
  }

  const ensureStream = async (
    streamPath: string,
    contentType = `application/json`,
    ownerEntityUrl?: string
  ): Promise<string> => {
    const response = await request(streamPath, {
      method: `PUT`,
      headers: {
        'content-type': contentType,
        ...(ownerEntityUrl ? { 'electric-owner-entity': ownerEntityUrl } : {}),
      },
    })

    if (!response.ok && response.status !== 409) {
      throw new Error(
        `failed to create stream ${streamPath} (${response.status}): ${await readErrorText(response)}`
      )
    }

    return streamPath
  }

  const signalEntity = async ({
    entityUrl,
    signal,
    reason,
    payload,
  }: SignalEntityOptions): Promise<{ txid: number }> => {
    const body: Record<string, unknown> = { signal }
    if (reason !== undefined) body.reason = reason
    if (payload !== undefined) body.payload = payload

    const response = await request(entityRpcPath(entityUrl, `/signal`), {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    })
    if (!response.ok) {
      throw new Error(
        `signal ${entityUrl} ${signal} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { txid: number }
  }

  const deleteEntity = async (entityUrl: string): Promise<void> => {
    try {
      await signalEntity({
        entityUrl,
        signal: `SIGKILL`,
        reason: `Runtime child cleanup`,
      })
    } catch (err) {
      if (err instanceof Error && /\(404\)/.test(err.message)) {
        return
      }
      throw err
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

  const ensureCronStream = async (
    expression: string,
    timezone?: string
  ): Promise<string> => {
    const response = await request(
      `/_electric/observations/cron/ensure-stream`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ expression, timezone }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `ensureCronStream failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    const data = (await response.json()) as { streamUrl: string }
    return data.streamUrl
  }

  const ensureEntitiesMembershipStream = async (
    tags: EntityTags
  ): Promise<{ streamUrl: string; sourceRef: string }> => {
    const response = await request(
      `/_electric/observations/entities/ensure-stream`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({ tags }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `ensureEntitiesMembershipStream failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { streamUrl: string; sourceRef: string }
  }

  const registerPgSyncSource = async (
    options: PgSyncOptions,
    metadata?: PgSyncRequestMetadata
  ): Promise<{ streamUrl: string; sourceRef: string }> => {
    const response = await request(`/_electric/pg-sync/register`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({ options, ...(metadata ? { metadata } : {}) }),
    })
    if (!response.ok) {
      throw new Error(
        `registerPgSyncSource failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { streamUrl: string; sourceRef: string }
  }

  const listEventSources = async (): Promise<Array<EventSourceContract>> => {
    const response = await request(`/_electric/event-sources`, {
      method: `GET`,
    })
    if (!response.ok) {
      throw new Error(
        `listEventSources failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    const data = (await response.json()) as {
      eventSources?: Array<EventSourceContract>
    }
    return data.eventSources ?? []
  }

  const subscribeToEventSource = async (
    options: EventSourceSubscriptionInput & { entityUrl: string }
  ): Promise<{ txid: string; subscription: EventSourceSubscription }> => {
    const id =
      options.id ??
      buildEventSourceSubscriptionId({
        sourceKey: options.sourceKey,
        bucketKey: options.bucketKey,
        params: options.params,
        filterKey: options.filterKey,
      })
    const response = await request(
      `${entityRpcPath(options.entityUrl)}/event-source-subscriptions/${encodeURIComponent(id)}`,
      {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          sourceKey: options.sourceKey,
          bucketKey: options.bucketKey,
          params: options.params,
          filterKey: options.filterKey,
          lifetime: options.lifetime,
          reason: options.reason,
        }),
      }
    )
    if (!response.ok) {
      throw new Error(
        `subscribeToEventSource failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as {
      txid: string
      subscription: EventSourceSubscription
    }
  }

  const unsubscribeFromEventSource = async (options: {
    entityUrl: string
    id: string
  }): Promise<{ txid: string }> => {
    const response = await request(
      `${entityRpcPath(options.entityUrl)}/event-source-subscriptions/${encodeURIComponent(options.id)}`,
      { method: `DELETE` }
    )
    if (!response.ok) {
      throw new Error(
        `unsubscribeFromEventSource failed (${response.status}): ${await readErrorText(response)}`
      )
    }
    return (await response.json()) as { txid: string }
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

  const deleteTag = async (
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
        `deleteTag ${entityUrl} failed (${response.status}): ${await readErrorText(response)}`
      )
    }
  }

  return {
    sendEntityMessage,
    createAttachment,
    readAttachment,
    spawnEntity,
    forkEntity,
    getEntity,
    ensureSharedStateStream,
    signalEntity,
    ensureStream,
    deleteEntity,
    getSharedStateStreamPath,
    registerWake,
    ensureCronStream,
    ensureEntitiesMembershipStream,
    registerPgSyncSource,
    listEventSources,
    subscribeToEventSource,
    unsubscribeFromEventSource,
    upsertCronSchedule,
    upsertFutureSendSchedule,
    deleteSchedule,
    setTag,
    deleteTag,
  }
}
