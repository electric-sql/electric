import { DurableStream, IdempotentProducer } from '@durable-streams/client'
import { createStreamDB, queryOnce } from '@durable-streams/state'
import { getEntityType } from './define-entity'
import { createEntityStreamDB } from './entity-stream-db'
import { entityStateSchema, isManagementEvent } from './entity-schema'
import { normalizeObservationSchema } from './observation-schema'
import { createWakeSession } from './wake-session'
import { createHandlerContext } from './context-factory'
import { createSetupContext } from './setup-context'
import { createEntityLogPrefix, runtimeLog } from './log'
import { createRuntimeServerClient } from './runtime-server-client'
import type {
  CronObservationSource,
  EntitiesObservationSource,
  EntityObservationSource,
} from './observation-sources'
import type {
  CollectionDefinition,
  EntityHandle,
  EntityStreamDBWithActions,
  ManifestEntry,
  ObservationHandle,
  ObservationSource,
  ProcessWakeConfig,
  SharedStateSchemaMap,
  Wake,
  WakeEvent,
  WakeMessage,
  WakeSession,
  WebhookNotification,
} from './types'
import type { JsonBatch } from '@durable-streams/client'
import type { ChangeEvent, StateEvent } from '@durable-streams/state'

interface WakeResult {
  manifest: Array<ManifestEntry>
  wakeSession: WakeSession
  sourceHandleCache: Map<string, EntityHandle>
}

interface WakeDeltaWindow {
  wakeEvent: WakeEvent
  wakeOffset: string
  ackOffset: string
  events: Array<ChangeEvent>
}

const DEFAULT_IDLE_TIMEOUT = 20_000
const DEFAULT_HEARTBEAT_INTERVAL = 30_000
type EntityStreamOptions = NonNullable<
  Parameters<typeof createEntityStreamDB>[3]
>
type EntityStreamHandle = NonNullable<EntityStreamOptions[`stream`]>

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

function constructWakeEvent(
  notification: WebhookNotification,
  catchUpEvents?: Array<ChangeEvent>
): WakeEvent {
  const fallbackSource = notification.entity?.url ?? notification.streamPath
  if (notification.wakeEvent) {
    return notification.wakeEvent
  }
  if (catchUpEvents) {
    for (let i = catchUpEvents.length - 1; i >= 0; i--) {
      const wakeEvent = changeEventToWakeEvent(
        catchUpEvents[i]!,
        fallbackSource
      )
      if (wakeEvent) {
        return wakeEvent
      }
    }
  }
  return {
    source: fallbackSource,
    type: notification.triggerEvent ?? `message`,
    fromOffset: 0,
    toOffset: 0,
    eventCount: 0,
    payload: undefined,
  }
}

function changeEventToWakeEvent(
  event: ChangeEvent,
  fallbackSource: string
): WakeEvent | null {
  if (event.type === `wake`) {
    const payload = event.value as WakeMessage | undefined
    return {
      source: payload?.source ?? fallbackSource,
      type: `wake`,
      fromOffset: 0,
      toOffset: 0,
      eventCount: 0,
      payload,
    }
  }

  if (event.type === `message_received`) {
    const value = event.value as
      | { from?: string; payload?: unknown; message_type?: string }
      | undefined
    return {
      source: value?.from ?? fallbackSource,
      type: `message_received`,
      fromOffset: 0,
      toOffset: 0,
      eventCount: 0,
      payload: value?.payload,
      summary: value?.message_type,
    }
  }

  return null
}

function selectWakeFromEvents(
  events: Array<ChangeEvent>,
  fallbackSource: string,
  preferredKind?: `message_received` | `wake`
): { wakeEvent: WakeEvent; offset: string | null } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!
    if (preferredKind && event.type !== preferredKind) {
      continue
    }

    const wakeEvent = changeEventToWakeEvent(event, fallbackSource)
    if (wakeEvent) {
      return {
        wakeEvent,
        offset: event.headers.offset ?? null,
      }
    }
  }

  return null
}

function createInFlightTracker() {
  let count = 0
  let resolve: (() => void) | null = null

  return {
    track<T>(promise: Promise<T>): Promise<T> {
      count++
      return promise.finally(() => {
        count--
        if (count === 0 && resolve) {
          resolve()
          resolve = null
        }
      })
    },
    async drain(): Promise<void> {
      if (count === 0) return
      return new Promise<void>((r) => {
        resolve = r
      })
    },
    get pending() {
      return count
    },
  }
}

export async function processWebhookWake(
  notification: WebhookNotification,
  config: ProcessWakeConfig
): Promise<WakeResult | null> {
  const {
    baseUrl,
    registry,
    shutdownSignal,
    idleTimeout = DEFAULT_IDLE_TIMEOUT,
    heartbeatInterval = DEFAULT_HEARTBEAT_INTERVAL,
  } = config
  const { callback, claimToken, epoch, wakeId } = notification
  const entityUrl = notification.entity?.url ?? notification.streamPath
  const typeName = notification.entity?.type
  const streamPath = notification.streamPath
  const logPrefix = createEntityLogPrefix(entityUrl)
  const log = {
    info: (message: string, ...args: Array<unknown>) =>
      runtimeLog.info(logPrefix, message, ...args),
    warn: (message: string, ...args: Array<unknown>) =>
      runtimeLog.warn(logPrefix, message, ...args),
    error: (message: string, ...args: Array<unknown>) =>
      runtimeLog.error(logPrefix, message, ...args),
  }
  const debugWakeTypes = process.env.ELECTRIC_AGENTS_DEBUG_WAKE_TYPES === `1`

  if (!typeName) {
    // Don't ack — let the server's own timeout reclaim the wake.
    // This runtime shouldn't be receiving wakes for types it doesn't handle.
    log.warn(`missing entity type, ignoring wake`)
    return null
  }

  const entry = registry ? registry.get(typeName) : getEntityType(typeName)
  if (!entry) {
    log.warn(`unknown entity type, ignoring wake`)
    return null
  }

  const streamUrl = `${baseUrl}${streamPath}`
  const notificationOffset =
    notification.streams.find((streamEntry) => streamEntry.path === streamPath)
      ?.offset ?? `-1`
  const io = createInFlightTracker()
  let serverHttpMs = 0
  let serverHttpCount = 0
  const serverClient = createRuntimeServerClient({
    baseUrl,
    track: <T>(promise: Promise<T>) => {
      const httpT0 = performance.now()
      const tracked = io.track(promise)
      tracked.then(
        () => {
          serverHttpMs += performance.now() - httpT0
          serverHttpCount++
        },
        () => {
          serverHttpMs += performance.now() - httpT0
          serverHttpCount++
        }
      )
      return tracked
    },
  })
  log.info(`wake received (epoch=${epoch})`)
  const wakeStartMs = performance.now()
  let claimMs = 0
  let preloadMs = 0
  let handlerMs = 0

  // 1. Single DurableStream shared by StreamDB, IdempotentProducer, and SSE tail.
  // StreamDB opens one SSE connection on preload(); all consumers share it.
  const catchUpEvents: Array<ChangeEvent> = []
  const pendingLiveBatches: Array<JsonBatch<StateEvent>> = []
  let preloaded = false
  let lastCatchUpOffset = notificationOffset
  let safeAckOffset = notificationOffset
  let currentWakeEvent = constructWakeEvent(notification)
  let currentWakeOffset = notificationOffset
  let currentWakeAckOffset = notificationOffset
  let currentWakeEvents: Array<ChangeEvent> = []
  let resolveCurrentWakeReady: (() => void) | null = null
  let queuedNextWake: WakeDeltaWindow | null = null

  let writeToken = ``
  const stream = new DurableStream({
    url: streamUrl,
    contentType: `application/json`,
  })

  // Create producer BEFORE the StreamDB so state actions can write through it.
  const producer = new IdempotentProducer(stream, `entity-${entityUrl}`, {
    epoch,
    autoClaim: true,
    fetch: (input, init) => {
      const headers = new Headers(init?.headers)
      if (writeToken) {
        headers.set(`authorization`, `Bearer ${writeToken}`)
      }
      return globalThis.fetch(input, { ...init, headers })
    },
    onError: (error) => {
      failBackgroundWake(error, `WRITE_FAILED`)
    },
  })
  const writeEvent = (event: ChangeEvent): void => {
    producer.append(JSON.stringify(event))
  }

  const db = createEntityStreamDB(
    streamUrl,
    entry.definition.state,
    entry.definition.actions,
    {
      stream: stream as unknown as EntityStreamHandle,
      actorFrom: entityUrl,
      onEvent: (event) => {
        if (preloaded) {
          handleRuntimeSideEffectEvent(event)
        }
      },
      onBatch: handleLiveBatch,
      writeEvent,
      flushWrites: () => producer.flush(),
    }
  )

  let activeClaimToken = claimToken
  let claimData: {
    ok: boolean
    claimToken?: string
    writeToken?: string
    error?: { code: string }
  } | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let claimedWake = false
  let result: WakeResult | null = null
  let primaryError: unknown = null
  let finalError: Error | AggregateError | null = null
  let shutdownRequested = shutdownSignal?.aborted ?? false
  let ackCurrentWakeOnFailure = false

  // Live event handler — wired after preload, processes child_status + inbox
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  let idleController: AbortController | null = null
  const secondaryDbs: Array<{
    drainPendingWrites?: () => Promise<void>
    flushWrites?: () => Promise<void>
    detachWrites?: () => Promise<void>
    close: () => void
  }> = []
  let liveProcessError: Error | null = null
  let acceptLiveInputs = false

  const compareOffsets = (left: string, right: string): number => {
    if (left === right) return 0
    if (left === `-1`) return -1
    if (right === `-1`) return 1
    return left < right ? -1 : 1
  }

  const setSafeAckOffset = (offset: string): void => {
    if (compareOffsets(offset, safeAckOffset) > 0) {
      safeAckOffset = offset
    }
  }

  const notifyCurrentWakeReady = (): void => {
    if (currentWakeOffset === `-1`) {
      return
    }
    resolveCurrentWakeReady?.()
    resolveCurrentWakeReady = null
  }

  const toChangeEvents = (batch: JsonBatch<StateEvent>): Array<ChangeEvent> => {
    return batch.items.filter(
      (event): event is ChangeEvent => `operation` in event.headers
    )
  }

  const clearIdleTimer = (): void => {
    if (idleTimer) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
  }

  const requestShutdown = (): void => {
    shutdownRequested = true
    clearIdleTimer()
    idleController?.abort()
  }

  shutdownSignal?.addEventListener(`abort`, requestShutdown)

  const armIdleTimer = (): void => {
    if (!acceptLiveInputs || !idleController) return

    clearIdleTimer()
    idleTimer = setTimeout(() => {
      idleController?.abort()
    }, idleTimeout)
  }

  const flushProducedWrites = async (): Promise<void> => {
    await producer.flush()
    if (producer.lastSuccessfulOffset) {
      setSafeAckOffset(producer.lastSuccessfulOffset)
    }
    drainNonFreshPendingBatches()
  }

  function failBackgroundWake(err: unknown, errorCode: string): void {
    if (liveProcessError) return

    liveProcessError = toError(err)
    log.error(`wake background task failed for ${entityUrl}:`, liveProcessError)
    writeEvent(
      entityStateSchema.errors.insert({
        key: `error-${epoch}-${crypto.randomUUID()}`,
        value: {
          error_code: errorCode,
          message: liveProcessError.message,
        } as never,
      }) as ChangeEvent
    )
    clearIdleTimer()
    idleController?.abort()
  }

  function handleRuntimeSideEffectEvent(event: ChangeEvent): void {
    if (event.type === `child_status` && result) {
      const spawnHandles = result.wakeSession.getSpawnHandles()
      const val = event.value as
        | { entity_url?: string; status?: string }
        | undefined
      if (val?.entity_url && spawnHandles.size > 0) {
        if (
          val.status === `idle` ||
          val.status === `completed` ||
          val.status === `stopped`
        ) {
          for (const [, spawnHandle] of spawnHandles) {
            spawnHandle.resolveRun()
          }
        }
      }
    }
  }

  const getFreshKind = (
    events: Array<ChangeEvent>
  ): `message_received` | `wake` | null => {
    let hasWake = false
    for (const event of events) {
      if (event.type === `message_received`) {
        return `message_received`
      }
      if (event.type === `wake`) {
        hasWake = true
      }
    }
    return hasWake ? `wake` : null
  }

  const isFreshEvent = (event: ChangeEvent): boolean => {
    return event.type === `message_received` || event.type === `wake`
  }

  const filterAcceptedLiveEvents = (
    batch: JsonBatch<StateEvent>
  ): Array<ChangeEvent> => {
    const changeEvents = toChangeEvents(batch)
    return changeEvents.filter((event) => {
      if (!isFreshEvent(event)) {
        return true
      }

      const eventOffset = event.headers.offset ?? batch.offset
      return compareOffsets(eventOffset, currentWakeOffset) > 0
    })
  }

  const adoptCurrentWakeOffsetFromLiveBatch = (
    batch: JsonBatch<StateEvent>
  ): void => {
    if (currentWakeOffset !== `-1`) {
      return
    }

    const changeEvents = toChangeEvents(batch)
    for (const event of changeEvents) {
      if (event.type !== currentWakeEvent.type) {
        continue
      }

      currentWakeEvent =
        changeEventToWakeEvent(event, entityUrl) ?? currentWakeEvent
      currentWakeOffset = event.headers.offset ?? batch.offset
      notifyCurrentWakeReady()
      if (debugWakeTypes) {
        log.info(
          `adopted live wake offset=${currentWakeOffset} for type=${currentWakeEvent.type}`
        )
      }
      return
    }
  }

  const waitForCurrentWakeInput = async (): Promise<void> => {
    if (currentWakeEvent.type !== `message_received`) {
      return
    }

    const hasConcreteMessageInput =
      currentWakeEvent.payload !== undefined ||
      catchUpEvents.some(
        (event) =>
          event.type === `message_received` &&
          (currentWakeOffset === `-1` ||
            event.headers.offset === currentWakeOffset)
      )

    if (hasConcreteMessageInput) {
      return
    }

    await new Promise<void>((resolve) => {
      let settled = false
      resolveCurrentWakeReady = () => {
        if (settled) return
        settled = true
        resolveCurrentWakeReady = null
        resolve()
      }
      setTimeout(() => {
        if (settled) return
        settled = true
        resolveCurrentWakeReady = null
        log.warn(
          `timed out waiting 100ms for concrete wake input; continuing with current wake payload`
        )
        resolve()
      }, 100)
    })
  }

  function drainNonFreshPendingBatches(): void {
    while (pendingLiveBatches.length > 0) {
      const batch = pendingLiveBatches[0]!
      const changeEvents = toChangeEvents(batch)
      if (getFreshKind(changeEvents) !== null) {
        return
      }
      pendingLiveBatches.shift()
      for (const event of changeEvents) {
        handleRuntimeSideEffectEvent(event)
      }
      setSafeAckOffset(batch.offset)
    }
  }

  function dequeueNextWakeFromPending(): WakeDeltaWindow | null {
    drainNonFreshPendingBatches()
    if (pendingLiveBatches.length === 0) return null

    const batches: Array<JsonBatch<StateEvent>> = []
    const deltaEvents: Array<ChangeEvent> = []
    let selectedKind: `message_received` | `wake` | null = null

    while (pendingLiveBatches.length > 0) {
      const batch = pendingLiveBatches[0]!
      const changeEvents = toChangeEvents(batch)
      const freshKind = getFreshKind(changeEvents)

      // Keep wake-only work together, but let a later message start its own
      // handler pass so message-triggered runs are not hidden behind older wakes.
      if (selectedKind === `wake` && freshKind === `message_received`) {
        break
      }

      pendingLiveBatches.shift()
      batches.push(batch)
      deltaEvents.push(...changeEvents)

      if (freshKind === `message_received`) {
        selectedKind = `message_received`
      } else if (freshKind === `wake` && selectedKind === null) {
        selectedKind = `wake`
      }
    }

    if (deltaEvents.length === 0) {
      return null
    }

    if (selectedKind === null) {
      for (const event of deltaEvents) {
        handleRuntimeSideEffectEvent(event)
      }
      setSafeAckOffset(batches[batches.length - 1]!.offset)
      return null
    }

    const selectedWake = selectWakeFromEvents(
      deltaEvents,
      entityUrl,
      selectedKind
    )
    if (!selectedWake) {
      throw new Error(
        `[agent-runtime] Invariant violation: selected fresh kind "${selectedKind}" but could not derive a wake event from pending batches`
      )
    }

    return {
      wakeEvent: selectedWake.wakeEvent,
      wakeOffset: selectedWake.offset ?? batches[batches.length - 1]!.offset,
      ackOffset: batches[batches.length - 1]!.offset,
      events: deltaEvents,
    }
  }

  function queueNextWakeIfReady(): void {
    if (queuedNextWake || !acceptLiveInputs) return
    queuedNextWake = dequeueNextWakeFromPending()
    if (queuedNextWake) {
      clearIdleTimer()
      idleController?.abort()
    }
  }

  function handleLiveBatch(batch: JsonBatch<StateEvent>): void {
    if (!preloaded) {
      const changeEvents = toChangeEvents(batch)
      if (changeEvents.length > 0) {
        catchUpEvents.push(...changeEvents)
      }
      lastCatchUpOffset = batch.offset
      return
    }

    const changeEvents = filterAcceptedLiveEvents(batch)
    adoptCurrentWakeOffsetFromLiveBatch(batch)
    if (changeEvents.length === 0) {
      setSafeAckOffset(batch.offset)
      return
    }

    catchUpEvents.push(...changeEvents)

    if (
      resolveCurrentWakeReady !== null &&
      getFreshKind(changeEvents) !== null
    ) {
      notifyCurrentWakeReady()
    }

    pendingLiveBatches.push({
      ...batch,
      items: changeEvents as Array<StateEvent>,
    })
    queueNextWakeIfReady()
  }

  try {
    // 2. Claim epoch + preload StreamDB (in parallel).
    // preload() opens ONE SSE connection, reads until up-to-date, and stays connected.
    // The onEvent callback collects raw events into catchUpEvents during preload.
    const claimT0 = performance.now()
    const claimPromise = fetch(callback, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer ${claimToken}`,
      },
      body: JSON.stringify({ epoch, wakeId }),
    }).then(async (response) => {
      claimData = (await response.json()) as {
        ok: boolean
        claimToken?: string
        writeToken?: string
        error?: { code: string }
      }
      if (claimData.claimToken) activeClaimToken = claimData.claimToken
      claimMs = +(performance.now() - claimT0).toFixed(2)
      return claimData
    })

    const preloadT0 = performance.now()
    const preloadPromise = db.preload().then(() => {
      preloadMs = +(performance.now() - preloadT0).toFixed(2)
    })
    const [claimed] = await Promise.all([claimPromise, preloadPromise])
    preloaded = true
    if (compareOffsets(db.offset, lastCatchUpOffset) > 0) {
      lastCatchUpOffset = db.offset
    }

    if (!claimed.ok) return null
    claimedWake = true
    writeToken = claimed.writeToken ?? ``

    // 3b. Start heartbeat once this worker owns the wake
    heartbeat = setInterval(() => {
      fetch(callback, {
        method: `POST`,
        headers: {
          'content-type': `application/json`,
          authorization: `Bearer ${activeClaimToken}`,
        },
        body: JSON.stringify({ epoch }),
      })
        .then(async (r) => {
          if (!r.ok) {
            failBackgroundWake(
              new Error(`heartbeat rejected (${r.status})`),
              `HEARTBEAT_FAILED`
            )
            return
          }
          const data = (await r.json()) as {
            ok: boolean
            claimToken?: string
          }
          if (!data.ok) {
            failBackgroundWake(
              new Error(`heartbeat rejected: server returned ok=false`),
              `HEARTBEAT_FAILED`
            )
            return
          }
          if (data.claimToken) activeClaimToken = data.claimToken
        })
        .catch((err: unknown) => {
          failBackgroundWake(err, `HEARTBEAT_FAILED`)
        })
    }, heartbeatInterval)

    const entityArgs = Object.freeze(notification.entity?.spawnArgs ?? {})

    // ---- Send executor — ctx.send() calls this directly (no queue) ----
    const executeSend = (send: {
      targetUrl: string
      payload: unknown
      type?: string
      afterMs?: number
    }): void => {
      void serverClient
        .sendEntityMessage({
          targetUrl: send.targetUrl,
          from: entityUrl,
          payload: send.payload,
          type: send.type,
          afterMs: send.afterMs,
        })
        .catch((err: unknown) => {
          failBackgroundWake(err, `SEND_FAILED`)
        })
    }

    // ---- Wiring helpers for inline spawn/observe ----
    const wiringConfig = {
      createOrGetChild: async (
        childType: string,
        childId: string,
        spawnArgs: Record<string, unknown>,
        parentUrl: string,
        opts?: {
          initialMessage?: unknown
          wake?: Wake
          tags?: Record<string, string>
        }
      ): Promise<{ entityUrl: string; streamPath: string }> => {
        const wakeOpt = opts?.wake
          ? {
              subscriberUrl: entityUrl,
              condition:
                typeof opts.wake === `object` && opts.wake.on === `runFinished`
                  ? (`runFinished` as const)
                  : opts.wake === `runFinished`
                    ? (`runFinished` as const)
                    : opts.wake,
              debounceMs:
                typeof opts.wake === `object` && opts.wake.on === `change`
                  ? opts.wake.debounceMs
                  : undefined,
              timeoutMs:
                typeof opts.wake === `object` && opts.wake.on === `change`
                  ? opts.wake.timeoutMs
                  : undefined,
              includeResponse:
                typeof opts.wake === `object` && opts.wake.on === `runFinished`
                  ? opts.wake.includeResponse
                  : undefined,
            }
          : undefined
        return serverClient.spawnEntity({
          type: childType,
          id: childId,
          args: spawnArgs,
          parentUrl,
          initialMessage: opts?.initialMessage,
          tags: opts?.tags,
          wake: wakeOpt,
        })
      },

      createChildDb: async (
        childStreamUrl: string,
        childTypeName?: string,
        onEvent?: (event: ChangeEvent) => void,
        opts?: { preload?: boolean }
      ): Promise<EntityStreamDBWithActions> => {
        const childEntry = childTypeName
          ? registry
            ? registry.get(childTypeName)
            : getEntityType(childTypeName)
          : undefined
        const childDb = createEntityStreamDB(
          childStreamUrl,
          childEntry?.definition.state,
          childEntry?.definition.actions,
          onEvent ? { onEvent } : undefined
        )
        secondaryDbs.push({
          drainPendingWrites: () => childDb.utils.drainPendingWrites(),
          close: () => childDb.close(),
        })
        if (opts?.preload !== false) {
          await childDb.preload()
        }
        return childDb
      },

      createSourceDb: async (
        sourceStreamUrl: string,
        sourceSchema: NonNullable<ObservationSource[`schema`]>,
        onEvent?: (event: ChangeEvent) => void,
        opts?: { preload?: boolean }
      ) => {
        const sourceDb = createStreamDB({
          streamOptions: {
            url: sourceStreamUrl,
            contentType: `application/json`,
          },
          ...(onEvent ? { onEvent } : {}),
          state: normalizeObservationSchema(sourceSchema),
        })
        secondaryDbs.push({
          close: () => sourceDb.close(),
        })
        if (opts?.preload !== false) {
          await sourceDb.preload()
        }
        return sourceDb
      },

      createSharedStateDb: async (
        ssId: string,
        mode: `create` | `connect`,
        ssSchema: SharedStateSchemaMap
      ): Promise<EntityStreamDBWithActions> => {
        const ssStreamPath = serverClient.getSharedStateStreamPath(ssId)
        if (mode === `create`) {
          await serverClient.ensureSharedStateStream(ssId)
        }
        const ssCollections: Record<string, CollectionDefinition> = {}
        for (const [collName, collSchema] of Object.entries(ssSchema)) {
          ssCollections[collName] = {
            type: collSchema.type,
            primaryKey: collSchema.primaryKey,
          }
        }
        const sharedStream = new DurableStream({
          url: `${baseUrl}${ssStreamPath}`,
          contentType: `application/json`,
        })
        const sharedProducer = new IdempotentProducer(
          sharedStream,
          `shared-state-${entityUrl}-${ssId}`,
          {
            epoch,
            autoClaim: true,
            onError: (error) => {
              failBackgroundWake(error, `WRITE_FAILED`)
            },
          }
        )
        const sharedDb = createEntityStreamDB(
          `${baseUrl}${ssStreamPath}`,
          ssCollections,
          undefined,
          {
            stream: sharedStream as unknown as EntityStreamHandle,
            actorFrom: entityUrl,
            writeEvent: (event) => {
              sharedProducer.append(JSON.stringify(event))
            },
            flushWrites: () => sharedProducer.flush(),
          }
        )
        secondaryDbs.push({
          drainPendingWrites: () => sharedDb.utils.drainPendingWrites(),
          flushWrites: async () => {
            await sharedProducer.flush()
          },
          detachWrites: () => sharedProducer.detach(),
          close: () => sharedDb.close(),
        })
        await sharedDb.preload()
        return sharedDb
      },
    }

    const wakeSession = createWakeSession(db, {
      writeEvent,
      flushWrites: flushProducedWrites,
    })
    const pendingWakeRegistrations: Array<Promise<void>> = []

    const filterEventsAtOrAboveOffset = (
      offsetBound: string
    ): Array<ChangeEvent> =>
      offsetBound === `-1`
        ? [...catchUpEvents]
        : catchUpEvents.filter((event) => {
            const offset = event.headers.offset
            if (typeof offset !== `string`) {
              return true
            }
            return compareOffsets(offset, offsetBound) >= 0
          })
    const eventOffset = (event: ChangeEvent): string | null => {
      const offset = event.headers.offset
      return typeof offset === `string` ? offset : null
    }
    const latestForkReconciliationOffset = (
      events: Array<ChangeEvent>
    ): string | null => {
      let latest: string | null = null
      for (const event of events) {
        const headers = event.headers as Record<string, unknown>
        if (typeof headers.forkedFrom !== `string`) {
          continue
        }
        const offset = eventOffset(event)
        if (!offset) {
          continue
        }
        if (latest === null || compareOffsets(offset, latest) > 0) {
          latest = offset
        }
      }
      return latest
    }
    const filterEventsAfterOffset = (
      events: Array<ChangeEvent>,
      offsetBound: string | null
    ): Array<ChangeEvent> => {
      if (offsetBound === null) {
        return events
      }
      return events.filter((event) => {
        const offset = eventOffset(event)
        if (offset === null) {
          return true
        }
        return compareOffsets(offset, offsetBound) > 0
      })
    }
    const eventsAtOrAfterNotification =
      filterEventsAtOrAboveOffset(notificationOffset)
    const forkReconciliationOffset = latestForkReconciliationOffset(
      eventsAtOrAfterNotification
    )
    const actionableEventsAtOrAfterNotification = filterEventsAfterOffset(
      eventsAtOrAfterNotification,
      forkReconciliationOffset
    )
    const initialFromCatchUp = notification.wakeEvent
      ? null
      : selectWakeFromEvents(actionableEventsAtOrAfterNotification, entityUrl)
    if (initialFromCatchUp) {
      currentWakeEvent = initialFromCatchUp.wakeEvent
      currentWakeOffset = initialFromCatchUp.offset ?? notificationOffset
    } else {
      currentWakeEvent = constructWakeEvent(notification)
      currentWakeOffset = notificationOffset
    }
    currentWakeAckOffset = lastCatchUpOffset
    notifyCurrentWakeReady()

    const computeCurrentNotificationEvents = (): Array<ChangeEvent> =>
      filterEventsAfterOffset(
        filterEventsAtOrAboveOffset(currentWakeOffset),
        forkReconciliationOffset
      )

    const currentNotificationEvents = computeCurrentNotificationEvents()

    const definition = entry.definition

    const hasFreshCatchUpInput =
      getFreshKind(currentNotificationEvents) !== null
    const hasOnlyManagementCatchUp =
      currentNotificationEvents.length > 0 &&
      currentNotificationEvents.every(isManagementEvent)
    const shouldSkipInitialHandlerPass =
      !notification.wakeEvent &&
      ((currentNotificationEvents.length > 0 &&
        (!hasFreshCatchUpInput || hasOnlyManagementCatchUp)) ||
        (forkReconciliationOffset !== null &&
          currentNotificationEvents.length === 0))
    if (debugWakeTypes) {
      log.info(
        `wake input type=${currentWakeEvent.type} offset=${currentWakeOffset}`
      )
    }
    const initialFirstWake =
      (await queryOnce((q) => q.from({ manifests: db.collections.manifests })))
        .length === 0
    const wiredSharedStateIds = new Set<string>()

    const setupCtx = createSetupContext({
      entityUrl,
      entityType: typeName,
      args: entityArgs,
      db,
      events: catchUpEvents,
      writeEvent,
      serverBaseUrl: baseUrl,
      effectScope: { disposeAll: async () => {} } as never,
      customStateNames: Object.keys(definition.state ?? {}),
      wakeSession,
      definition,
      wiring: wiringConfig,
      executeSend,
    })
    setupCtx.restorePersistedSharedStateHandles()

    const doObserve = async (
      source: ObservationSource,
      wake?: Wake
    ): Promise<ObservationHandle> => {
      // Self-observation
      if (
        source.sourceType === `entity` &&
        (source as EntityObservationSource).entityUrl === entityUrl
      ) {
        const manifestEntry = source.toManifestEntry()
        wakeSession.registerManifestEntry({
          ...manifestEntry,
          ...(wake ? { wake } : {}),
        })
        return {
          sourceType: `entity`,
          sourceRef: entityUrl,
          entityUrl,
          db,
          events: catchUpEvents,
          run: Promise.resolve(),
          text() {
            return Promise.resolve([])
          },
          send: (msg: unknown) => {
            executeSend({ targetUrl: entityUrl, payload: msg })
          },
          status: () => undefined,
        } as EntityHandle
      }

      // When the source has a built-in wake() (e.g. cron), auto-register it
      // even if the caller didn't pass explicit wake opts.
      const sourceWakeConfig = source.wake ? source.wake() : undefined
      const effectiveWake = wake ?? sourceWakeConfig?.condition

      if (source.sourceType === `cron`) {
        await serverClient.registerCronSource(
          (source as CronObservationSource).expression,
          (source as CronObservationSource).timezone
        )
      }

      if (source.sourceType === `entities`) {
        await serverClient.registerEntitiesSource(
          (source as EntitiesObservationSource).tags
        )
      }

      if (effectiveWake) {
        const observeHandle = await setupCtx.observe(source, {
          wake: effectiveWake,
        })

        const sourceUrl =
          sourceWakeConfig?.sourceUrl ??
          (source.sourceType === `entity`
            ? (source as EntityObservationSource).entityUrl
            : source.streamUrl)
        if (!sourceUrl) {
          throw new Error(
            `[agent-runtime] Cannot register wake for source '${source.sourceType}:${source.sourceRef}' without a source URL`
          )
        }

        const condition = wake
          ? typeof wake === `object` && wake.on === `runFinished`
            ? (`runFinished` as const)
            : wake === `runFinished`
              ? (`runFinished` as const)
              : wake
          : sourceWakeConfig!.condition

        await serverClient.registerWake({
          subscriberUrl: entityUrl,
          sourceUrl,
          condition,
          debounceMs: wake
            ? typeof wake === `object` && wake.on === `change`
              ? wake.debounceMs
              : undefined
            : sourceWakeConfig?.debounceMs,
          timeoutMs: wake
            ? typeof wake === `object` && wake.on === `change`
              ? wake.timeoutMs
              : undefined
            : sourceWakeConfig?.timeoutMs,
          includeResponse: wake
            ? typeof wake === `object` && wake.on === `runFinished`
              ? wake.includeResponse
              : undefined
            : sourceWakeConfig?.includeResponse,
          manifestKey: source.toManifestEntry().key,
        })

        if (source.sourceType === `db`) {
          scheduleSharedStateWiring()
          await waitForSharedStateWiring()
        }

        return observeHandle
      }

      const observeHandle = await setupCtx.observe(source)
      if (source.sourceType === `db`) {
        scheduleSharedStateWiring()
        await waitForSharedStateWiring()
      }
      return observeHandle
    }

    const doSpawn = (
      type: string,
      id: string,
      spawnArgs?: Record<string, unknown>,
      opts?: {
        initialMessage?: unknown
        wake?: Wake
        tags?: Record<string, string>
        observe?: boolean
      }
    ): Promise<EntityHandle> => {
      return setupCtx.spawn(type, id, spawnArgs, opts)
    }

    const doMkdb = <TSchema extends SharedStateSchemaMap>(
      id: string,
      schema: TSchema
    ) => {
      const handle = setupCtx.mkdb(id, schema)
      scheduleSharedStateWiring()
      return handle
    }

    const wirePendingSharedStates = async (): Promise<void> => {
      for (const [ssId, ssHandle] of wakeSession.getSharedStateHandles()) {
        if (wiredSharedStateIds.has(ssId)) continue
        const ssDb = await wiringConfig.createSharedStateDb(
          ssId,
          ssHandle.mode,
          ssHandle.schema
        )
        await ssHandle.wireDb(ssDb)
        wiredSharedStateIds.add(ssId)
      }
    }

    let pendingSharedStateWiring: Promise<void> = Promise.resolve()
    const scheduleSharedStateWiring = (): void => {
      pendingSharedStateWiring = pendingSharedStateWiring
        .then(() => wirePendingSharedStates())
        .catch((err) => {
          failBackgroundWake(err, `SHARED_STATE_WIRING_FAILED`)
        })
    }
    const waitForSharedStateWiring = async (): Promise<void> => {
      await pendingSharedStateWiring
    }
    const drainAllPendingWrites = async (): Promise<void> => {
      await db.utils.drainPendingWrites()
      for (const sdb of secondaryDbs) {
        await sdb.drainPendingWrites?.()
      }
    }
    setSafeAckOffset(lastCatchUpOffset)

    let setupComplete = false
    let skipInitialHandlerPass = shouldSkipInitialHandlerPass

    if (!skipInitialHandlerPass) {
      await waitForCurrentWakeInput()
      currentWakeEvents = computeCurrentNotificationEvents()
      const initialWake = selectWakeFromEvents(
        currentWakeEvents,
        entityUrl,
        getFreshKind(currentWakeEvents) ?? undefined
      )
      if (initialWake) {
        currentWakeEvent = initialWake.wakeEvent
        currentWakeOffset = initialWake.offset ?? currentWakeOffset
      }
      currentWakeAckOffset = lastCatchUpOffset

      const initialPendingWake = dequeueNextWakeFromPending()
      if (
        initialPendingWake &&
        initialPendingWake.wakeEvent.type === currentWakeEvent.type &&
        compareOffsets(initialPendingWake.wakeOffset, currentWakeOffset) === 0
      ) {
        currentWakeAckOffset = initialPendingWake.ackOffset
      } else if (initialPendingWake) {
        queuedNextWake = initialPendingWake
      }
    }

    const awaitIdleForFreshWork = async (message: string): Promise<boolean> => {
      if (idleTimeout <= 0) {
        return false
      }

      log.info(message)
      acceptLiveInputs = true
      idleController = new AbortController()
      const idleSignal = idleController.signal
      const idleWait = new Promise<void>((resolve) => {
        if (idleSignal.aborted) {
          resolve()
          return
        }
        idleSignal.addEventListener(`abort`, () => resolve(), { once: true })
      })
      armIdleTimer()
      queueNextWakeIfReady()
      await idleWait

      acceptLiveInputs = false
      clearIdleTimer()

      if (liveProcessError) {
        throw liveProcessError
      }

      if (shutdownRequested || queuedNextWake === null) {
        return false
      }

      log.info(`fresh work arrived during idle, continuing in-process`)
      const resumedWake = queuedNextWake
      currentWakeEvent = resumedWake.wakeEvent
      currentWakeOffset = resumedWake.wakeOffset
      currentWakeAckOffset = resumedWake.ackOffset
      currentWakeEvents = resumedWake.events
      queuedNextWake = null
      if (debugWakeTypes) {
        log.info(
          `resumed wake type=${currentWakeEvent.type} offset=${currentWakeOffset} ack=${currentWakeAckOffset}`
        )
      }
      return true
    }

    for (;;) {
      if (skipInitialHandlerPass) {
        skipInitialHandlerPass = false
        const resumed = await awaitIdleForFreshWork(
          `skipping initial handler pass: no fresh wake input in catch-up; entering idle (${idleTimeout / 1000}s timeout)`
        )
        if (resumed) {
          continue
        }
        break
      }

      const electricTools = config.createElectricTools
        ? await config.createElectricTools({
            entityUrl,
            entityType: typeName,
            args: entityArgs,
            db,
            events: currentWakeEvents,
            upsertCronSchedule: (opts) =>
              serverClient.upsertCronSchedule({
                entityUrl,
                ...opts,
              }),
            upsertFutureSendSchedule: (opts) =>
              serverClient.upsertFutureSendSchedule({
                entityUrl,
                ...opts,
              }),
            deleteSchedule: (opts) =>
              serverClient.deleteSchedule({
                entityUrl,
                ...opts,
              }),
          })
        : []

      const { ctx: handlerCtx, getSleepRequested } = createHandlerContext({
        entityUrl,
        entityType: typeName,
        epoch,
        wakeOffset: currentWakeOffset,
        firstWake: initialFirstWake && !setupComplete,
        tags: Object.freeze(
          (notification.entity as { tags?: Record<string, string> } | undefined)
            ?.tags ?? {}
        ),
        args: entityArgs,
        db,
        state: setupCtx.state,
        events: currentWakeEvents,
        actions: setupCtx.actions,
        electricTools,
        writeEvent,
        wakeSession,
        wakeEvent: currentWakeEvent,
        doObserve,
        doSpawn,
        doMkdb,
        prepareAgentRun: waitForSharedStateWiring,
        executeSend: (send) => executeSend(send),
        doSetTag: (key, value) =>
          serverClient.setTag(entityUrl, key, value, writeToken),
        doRemoveTag: (key) =>
          serverClient.removeTag(entityUrl, key, writeToken),
      })

      let sleepRequested = false

      try {
        await wirePendingSharedStates()
        if (!setupComplete) {
          setupCtx.setInSetup(false)
          setupComplete = true
        }

        log.info(
          `invoking handler wakeType=${currentWakeEvent.type} ` +
            `wakeOffset=${currentWakeOffset} ackOffset=${currentWakeAckOffset} ` +
            `events=${currentWakeEvents.length} ` +
            `payloadType=${typeof currentWakeEvent.payload} ` +
            `firstWake=${initialFirstWake && !setupComplete}`
        )
        const handlerT0 = performance.now()
        await definition.handler(handlerCtx, currentWakeEvent)
        handlerMs += +(performance.now() - handlerT0).toFixed(2)
        log.info(`handler returned`)
        await waitForSharedStateWiring()
        await drainAllPendingWrites()
        await Promise.all(pendingWakeRegistrations)
        pendingWakeRegistrations.length = 0
        await wakeSession.commitManifestEntries()
        await flushProducedWrites()
        if (result) {
          result.manifest = await queryOnce((q) =>
            q.from({ manifests: db.collections.manifests })
          )
        }

        sleepRequested = getSleepRequested()

        if (liveProcessError) {
          throw liveProcessError
        }
      } catch (setupErr) {
        wakeSession.rollbackManifestEntries()
        const errMsg = toError(setupErr).message
        log.error(`handler failed for ${entityUrl}:`, errMsg)
        writeEvent(
          entityStateSchema.errors.insert({
            key: `error-${epoch}-${crypto.randomUUID()}`,
            value: {
              error_code: `HANDLER_FAILED`,
              message: errMsg,
            } as never,
          }) as ChangeEvent
        )
        ackCurrentWakeOnFailure = true

        const manifest = wakeSession.getManifest()
        const spawnedChildren = manifest.filter(
          (e): e is typeof e & { kind: `child` } => e.kind === `child`
        )
        if (spawnedChildren.length > 0) {
          log.warn(
            `handler failed — attempting to close ${spawnedChildren.length} child(ren) spawned before the failure`
          )
          const cleanupErrors: Array<Error> = []
          for (const childEntry of spawnedChildren) {
            try {
              await serverClient.deleteEntity(childEntry.entity_url)
            } catch (err) {
              cleanupErrors.push(toError(err))
            }
          }
          if (cleanupErrors.length > 0) {
            throw new AggregateError(
              [toError(setupErr), ...cleanupErrors],
              `Wake handler failed and child cleanup also failed`
            )
          }
        }
        throw setupErr
      }

      if (!result) {
        result = {
          manifest: wakeSession.getManifest(),
          wakeSession,
          sourceHandleCache: setupCtx.getSourceHandleCache(),
        }
      }

      setSafeAckOffset(currentWakeAckOffset)

      if (shutdownRequested) {
        log.info(`shutdown requested, closing wake`)
        break
      }

      if (sleepRequested) {
        drainNonFreshPendingBatches()
        log.info(`handler returned with sleep(), closing immediately`)
        break
      }

      const nextWake = dequeueNextWakeFromPending()
      if (nextWake) {
        log.info(
          debugWakeTypes
            ? `fresh work already pending, continuing in-process (type=${nextWake.wakeEvent.type}, offset=${nextWake.wakeOffset}, ack=${nextWake.ackOffset})`
            : `fresh work already pending, continuing in-process`
        )
        currentWakeEvent = nextWake.wakeEvent
        currentWakeOffset = nextWake.wakeOffset
        currentWakeAckOffset = nextWake.ackOffset
        currentWakeEvents = nextWake.events
        continue
      }

      const resumed = await awaitIdleForFreshWork(
        `handler returned, entering idle (${idleTimeout / 1000}s timeout)`
      )
      if (resumed) {
        continue
      }
      break
    }
  } catch (err) {
    primaryError = err
    throw err
  } finally {
    shutdownSignal?.removeEventListener(`abort`, requestShutdown)
    // 6. Clean up: flush producer, dispose effects, close StreamDB, cancel heartbeat, signal done
    const cleanupErrors: Array<Error> = []
    if (heartbeat) {
      clearInterval(heartbeat)
    }
    try {
      await io.drain()
    } catch (err) {
      cleanupErrors.push(toError(err))
    }
    try {
      await db.utils.drainPendingWrites()
    } catch (err) {
      cleanupErrors.push(toError(err))
    }
    for (const sdb of secondaryDbs) {
      try {
        await sdb.drainPendingWrites?.()
      } catch (err) {
        cleanupErrors.push(toError(err))
      }
    }
    try {
      await flushProducedWrites()
    } catch (err) {
      cleanupErrors.push(toError(err))
    }
    // Updated by the handler-error path before control reaches this async cleanup.

    if (ackCurrentWakeOnFailure && cleanupErrors.length === 0) {
      setSafeAckOffset(currentWakeAckOffset)
    }
    if (result) {
      try {
        await result.wakeSession.close()
      } catch (err) {
        cleanupErrors.push(toError(err))
      }
    }
    const doneOffset = safeAckOffset
    for (const sdb of secondaryDbs) {
      try {
        await sdb.flushWrites?.()
      } catch (err) {
        cleanupErrors.push(toError(err))
      }
    }
    for (const sdb of secondaryDbs) {
      try {
        await sdb.detachWrites?.()
      } catch (err) {
        cleanupErrors.push(toError(err))
      }
    }
    try {
      await producer.detach()
    } catch (err) {
      cleanupErrors.push(toError(err))
    }
    for (const sdb of secondaryDbs) {
      try {
        sdb.close()
      } catch (err: unknown) {
        cleanupErrors.push(toError(err))
      }
    }
    db.close()
    if (claimedWake) {
      log.info(
        doneOffset === `-1`
          ? `done without ack (no consumed offset)`
          : `done acking ${streamPath} at ${doneOffset}`
      )
      if (shutdownRequested) {
        log.info(`shutdown requested, skipping done callback`)
      } else {
        try {
          await sendDone(
            callback,
            activeClaimToken,
            epoch,
            streamPath,
            doneOffset === `-1` ? null : doneOffset
          )
        } catch (err) {
          cleanupErrors.push(toError(err))
        }
      }
    }
    if (primaryError != null || cleanupErrors.length > 0) {
      const errors = [
        ...(primaryError != null ? [toError(primaryError)] : []),
        ...cleanupErrors,
      ]
      finalError =
        errors.length === 1
          ? errors[0]!
          : new AggregateError(
              errors,
              `Wake failed during processing or cleanup`
            )
    }
  }

  const totalMs = +(performance.now() - wakeStartMs).toFixed(2)
  const httpMs = +serverHttpMs.toFixed(2)
  log.info(
    `wake done claimMs=${claimMs} preloadMs=${preloadMs} ` +
      `handlerMs=${handlerMs} httpMs=${httpMs} httpCount=${serverHttpCount} ` +
      `totalMs=${totalMs}`
  )

  if (finalError) {
    throw finalError
  }

  return result
}

export const processWake: typeof processWebhookWake = processWebhookWake

async function sendDone(
  callback: string,
  token: string,
  epoch: number,
  streamPath: string,
  offset: string | null
): Promise<void> {
  const response = await fetch(callback, {
    method: `POST`,
    headers: {
      'content-type': `application/json`,
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      epoch,
      acks: offset ? [{ path: streamPath, offset }] : [],
      done: true,
    }),
  })

  if (!response.ok) {
    let body = ``
    try {
      body = await response.text()
    } catch {
      body = `<body unreadable>`
    }
    throw new Error(
      `Done callback failed (${response.status}): ${body || response.statusText}`
    )
  }
}
