import { createActor } from 'xstate'
import { DurableStream } from '@durable-streams/client'
import { DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS } from './constants'
import { createPullWakeMachine } from './pull-wake-machine'
import { appendPathToUrl } from './url'
import type { RuntimeRouter } from './create-handler'
import type {
  HeadersProvider,
  ProcessWakeConfig,
  WakeNotification,
} from './types'

export interface PullWakeEvent {
  type: `wake`
  subscription_id: string
  stream: string
  generation: number
  ts?: string | number
}

export interface PullWakeRunnerConfig {
  baseUrl: string
  runnerId: string
  runtime: PullWakeRuntime
  offset?: string
  headers?: HeadersProvider
  claimHeaders?: ProcessWakeConfig[`claimHeaders`]
  claimTokenHeader?: ProcessWakeConfig[`claimTokenHeader`]
  wakeStreamPath?: string
  heartbeatIntervalMs?: number
  eventHeartbeatThrottleMs?: number
  leaseMs?: number
  heartbeatPath?: string
  claimPath?: string
  onError?: (error: Error) => void
  streamFactory?: (opts: {
    url: string
    headers?: Record<string, string>
    offset?: string
    signal: AbortSignal
  }) => Promise<PullWakeStreamResponse>
}

type PullWakeRuntime = Pick<
  RuntimeRouter,
  `dispatchWake` | `drainWakes` | `abortWakes`
> & {
  isWakeActive?: RuntimeRouter[`isWakeActive`]
}

export interface PullWakeStreamResponse {
  jsonStream: () => AsyncIterable<PullWakeEvent>
  readonly offset?: string
  cancel?: (reason?: unknown) => void
  closed?: Promise<void>
}

export interface PullWakeRunner {
  start: () => void
  stop: () => Promise<void>
  waitForStopped: () => Promise<void>
  readonly running: boolean
  readonly offset: string | undefined
  getHealth: () => PullWakeRunnerHealth
}

export type PullWakeRunnerStatus =
  | `stopped`
  | `starting`
  | `connecting`
  | `streaming`
  | `reconnecting`
  | `stopping`

export interface PullWakeRunnerHealth {
  running: boolean
  status: PullWakeRunnerStatus
  offset: string | undefined
  started_at: string | null
  stream_connected: boolean
  stream_connected_since: string | null
  reconnect_count: number
  last_error: string | null
  last_error_at: string | null
  last_heartbeat_at: string | null
  last_heartbeat_ok: boolean
  last_claim_at: string | null
  last_claim_result: `claimed` | `no_work` | `error` | null
  last_dispatch_at: string | null
  events_received: number
  claims_succeeded: number
  claims_skipped: number
  claims_failed: number
}

const CLAIM_ACTOR_STOP_GRACE_MS = 1_000
const DEFAULT_EVENT_HEARTBEAT_THROTTLE_MS = 2_000
const HEARTBEAT_FAILURE_STREAM_RESET_THRESHOLD = 2
const DEFERRED_WAKE_RETRY_MS = 25

export function createPullWakeRunner(
  config: PullWakeRunnerConfig
): PullWakeRunner {
  // The xstate machine owns the lifecycle (which phase, what transitions are
  // legal, when to abort in-flight work). This closure owns diagnostics,
  // heartbeating, and claim processing — effects the machine triggers.
  let controller: AbortController | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let eventHeartbeatTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatInFlight: Promise<void> | null = null
  let heartbeatInFlightSignal: AbortSignal | null = null
  let heartbeatPending = false
  let currentOffset = config.offset ?? `-1`
  let startedAt: string | null = null
  let streamConnectedSince: string | null = null
  let reconnectCount = 0
  let lastError: string | null = null
  let lastErrorAt: string | null = null
  let lastHeartbeatAt: string | null = null
  let lastHeartbeatOk = false
  let lastClaimAt: string | null = null
  let lastClaimResult: PullWakeRunnerHealth[`last_claim_result`] = null
  let lastDispatchAt: string | null = null
  let eventsReceived = 0
  let claimsSucceeded = 0
  let claimsSkipped = 0
  let claimsFailed = 0
  let consecutiveHeartbeatFailures = 0
  let stopPromise: Promise<void> | null = null
  const claimActors = new Set<Promise<void>>()
  const claimingStreamPaths = new Set<string>()
  const deferredWakeEventsByStreamPath = new Map<string, PullWakeEvent>()
  const deferredWakeTimersByStreamPath = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()

  const wakePath =
    config.wakeStreamPath ??
    `/runners/${encodeURIComponent(config.runnerId)}/wake`
  const wakeUrl = appendPathToUrl(config.baseUrl, wakePath)
  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS
  const eventHeartbeatThrottleMs = Math.max(
    0,
    config.eventHeartbeatThrottleMs ?? DEFAULT_EVENT_HEARTBEAT_THROTTLE_MS
  )
  const leaseMs = config.leaseMs ?? heartbeatIntervalMs * 3
  const heartbeatPath =
    config.heartbeatPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/heartbeat`
  const heartbeatUrl = appendPathToUrl(config.baseUrl, heartbeatPath)
  const claimPath =
    config.claimPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/claim`
  const claimUrl = appendPathToUrl(config.baseUrl, claimPath)

  const toStatus = (): PullWakeRunnerStatus => {
    const snapshot = actor.getSnapshot()
    if (snapshot.matches(`stopped`)) return `stopped`
    if (snapshot.matches({ running: `connecting` })) return `connecting`
    if (snapshot.matches({ running: `streaming` })) return `streaming`
    if (snapshot.matches({ running: `reconnecting` })) return `reconnecting`
    return `stopping`
  }

  const isRunningState = (): boolean => actor.getSnapshot().matches(`running`)

  const isStreaming = (): boolean =>
    actor.getSnapshot().matches({ running: `streaming` })

  const buildDiagnostics = (): Omit<
    PullWakeRunnerHealth,
    `running` | `offset`
  > => ({
    status: toStatus(),
    started_at: startedAt,
    stream_connected: isStreaming(),
    stream_connected_since: streamConnectedSince,
    reconnect_count: reconnectCount,
    last_error: lastError,
    last_error_at: lastErrorAt,
    last_heartbeat_at: lastHeartbeatAt,
    last_heartbeat_ok: lastHeartbeatOk,
    last_claim_at: lastClaimAt,
    last_claim_result: lastClaimResult,
    last_dispatch_at: lastDispatchAt,
    events_received: eventsReceived,
    claims_succeeded: claimsSucceeded,
    claims_skipped: claimsSkipped,
    claims_failed: claimsFailed,
  })

  const resolveHeaders = async (): Promise<Record<string, string>> => {
    const init =
      typeof config.headers === `function`
        ? await config.headers()
        : config.headers
    return Object.fromEntries(new Headers(init).entries())
  }

  const resolveClaimHeaders = async (): Promise<HeadersInit> => {
    const init =
      typeof config.claimHeaders === `function`
        ? await config.claimHeaders()
        : config.claimHeaders
    const headers = new Headers(init)
    if (!headers.has(`electric-runner-id`)) {
      headers.set(`electric-runner-id`, config.runnerId)
    }
    return headers
  }

  const reportError = (err: unknown): void => {
    const error = err instanceof Error ? err : new Error(String(err))
    lastError = error.message
    lastErrorAt = new Date().toISOString()
    try {
      config.onError?.(error)
    } catch (reporterError) {
      // onError is reporting-only; reporters must not control runner lifecycle.
      console.error(`Pull-wake runner onError callback failed`, reporterError)
    }
  }

  const notifyHeartbeatChange = (): void => {
    const signal = controller?.signal
    if (!signal || signal.aborted || eventHeartbeatThrottleMs <= 0) return
    if (eventHeartbeatTimer) return
    eventHeartbeatTimer = setTimeout(() => {
      eventHeartbeatTimer = null
      requestHeartbeat(signal)
    }, eventHeartbeatThrottleMs)
  }

  const requestHeartbeat = (signal: AbortSignal): void => {
    if (signal.aborted) return
    heartbeatPending = true
    if (heartbeatInFlight && heartbeatInFlightSignal === signal) return
    const inFlight = flushHeartbeats(signal).finally(() => {
      if (heartbeatInFlight === inFlight) {
        heartbeatInFlight = null
        heartbeatInFlightSignal = null
      }
    })
    heartbeatInFlight = inFlight
    heartbeatInFlightSignal = signal
  }

  const flushHeartbeats = async (signal: AbortSignal): Promise<void> => {
    while (heartbeatPending && !signal.aborted) {
      heartbeatPending = false
      await sendHeartbeat(signal)
    }
  }

  const sendHeartbeat = async (signal: AbortSignal): Promise<void> => {
    try {
      const headers = new Headers(await resolveHeaders())
      headers.set(`content-type`, `application/json`)
      const res = await fetch(heartbeatUrl, {
        method: `POST`,
        headers,
        body: JSON.stringify({
          lease_ms: leaseMs,
          wake_stream_offset: currentOffset,
          diagnostics: buildDiagnostics(),
        }),
        signal,
      })
      lastHeartbeatAt = new Date().toISOString()
      if (!res.ok) {
        throw new Error(
          `Pull-wake runner heartbeat failed for ${config.runnerId}: ${res.status} ${await res.text()}`
        )
      }
      lastHeartbeatOk = true
      consecutiveHeartbeatFailures = 0
    } catch (err) {
      if (!signal.aborted) {
        lastHeartbeatOk = false
        consecutiveHeartbeatFailures++
        reportError(err)
        if (
          consecutiveHeartbeatFailures >=
          HEARTBEAT_FAILURE_STREAM_RESET_THRESHOLD
        ) {
          actor.send({
            type: `STREAM_RESET`,
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      }
    }
  }

  const startHeartbeat = (signal: AbortSignal): void => {
    if (heartbeatIntervalMs <= 0) return
    requestHeartbeat(signal)
    heartbeatTimer = setInterval(() => {
      requestHeartbeat(signal)
    }, heartbeatIntervalMs)
  }

  const stopHeartbeat = (): void => {
    heartbeatPending = false
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (eventHeartbeatTimer) {
      clearTimeout(eventHeartbeatTimer)
      eventHeartbeatTimer = null
    }
  }

  const streamFactory =
    config.streamFactory ??
    (async (opts) => {
      const stream = new DurableStream({
        url: opts.url,
        headers: opts.headers,
        offset: opts.offset,
        signal: opts.signal,
        contentType: `application/json`,
      } as any)
      return (await stream.stream<PullWakeEvent>({
        live: true,
        json: true,
        offset: opts.offset,
        signal: opts.signal,
        onError: (error) => {
          reportError(error)
          return {}
        },
      })) as PullWakeStreamResponse
    })

  const recordClaimSkipped = (): null => {
    lastClaimResult = `no_work`
    claimsSkipped++
    notifyHeartbeatChange()
    return null
  }

  const recordClaimError = (): void => {
    lastClaimResult = `error`
    claimsFailed++
    notifyHeartbeatChange()
  }

  const normalizeStreamPath = (stream: string): string =>
    stream.startsWith(`/`) ? stream : `/${stream}`

  const hasActiveStreamClaim = (streamPath: string): boolean =>
    claimingStreamPaths.has(streamPath) ||
    config.runtime.isWakeActive?.(streamPath) === true

  const clearDeferredWakeRetries = (): void => {
    for (const timer of deferredWakeTimersByStreamPath.values()) {
      clearTimeout(timer)
    }
    deferredWakeTimersByStreamPath.clear()
    deferredWakeEventsByStreamPath.clear()
  }

  const drainQueuedWakeClaims = (
    streamPath: string,
    signal: AbortSignal
  ): void => {
    const timer = deferredWakeTimersByStreamPath.get(streamPath)
    if (timer) {
      clearTimeout(timer)
      deferredWakeTimersByStreamPath.delete(streamPath)
    }

    const deferredEvent = deferredWakeEventsByStreamPath.get(streamPath)
    if (!deferredEvent || signal.aborted || !isRunningState()) {
      deferredWakeEventsByStreamPath.delete(streamPath)
      return
    }
    if (hasActiveStreamClaim(streamPath)) {
      scheduleDeferredWakeRetry(streamPath, signal)
      return
    }

    deferredWakeEventsByStreamPath.delete(streamPath)
    spawnClaimActor(deferredEvent, signal)
  }

  const scheduleDeferredWakeRetry = (
    streamPath: string,
    signal: AbortSignal
  ): void => {
    if (deferredWakeTimersByStreamPath.has(streamPath)) return

    const timer = setTimeout(
      () => drainQueuedWakeClaims(streamPath, signal),
      DEFERRED_WAKE_RETRY_MS
    )
    timer.unref?.()
    deferredWakeTimersByStreamPath.set(streamPath, timer)
  }

  const scheduleDeferredWakeClaim = (
    event: PullWakeEvent,
    signal: AbortSignal
  ): void => {
    const streamPath = normalizeStreamPath(event.stream)
    if (!deferredWakeEventsByStreamPath.has(streamPath)) {
      deferredWakeEventsByStreamPath.set(streamPath, event)
    }
    if (hasActiveStreamClaim(streamPath)) {
      recordClaimSkipped()
      scheduleDeferredWakeRetry(streamPath, signal)
      return
    }
    drainQueuedWakeClaims(streamPath, signal)
  }

  const claimWake = async (
    event: PullWakeEvent,
    signal: AbortSignal
  ): Promise<WakeNotification | null> => {
    lastClaimAt = new Date().toISOString()
    lastClaimResult = null
    notifyHeartbeatChange()
    let claimErrorRecorded = false
    try {
      const headers = new Headers(await resolveHeaders())
      headers.set(`content-type`, `application/json`)
      const response = await fetch(claimUrl, {
        method: `POST`,
        headers,
        signal,
        body: JSON.stringify(event),
      })
      if (response.status === 204) return recordClaimSkipped()
      if (!response.ok) {
        const text = await response.text()
        if (
          response.status === 409 &&
          (text.includes(`ALREADY_CLAIMED`) || text.includes(`NO_PENDING_WORK`))
        ) {
          return recordClaimSkipped()
        }
        recordClaimError()
        claimErrorRecorded = true
        throw new Error(
          `Pull-wake claim failed for ${config.runnerId}: ${response.status} ${text}`
        )
      }
      const notification = (await response.json()) as WakeNotification & {
        done?: boolean
      }
      if (notification.done) return recordClaimSkipped()
      lastClaimResult = `claimed`
      claimsSucceeded++
      notifyHeartbeatChange()
      return notification
    } catch (err) {
      if (signal.aborted) {
        throw err
      }
      if (!claimErrorRecorded) {
        recordClaimError()
      }
      throw err
    }
  }

  const claimAndDispatch = async (
    event: PullWakeEvent,
    signal: AbortSignal
  ): Promise<void> => {
    const streamPath = normalizeStreamPath(event.stream)
    if (hasActiveStreamClaim(streamPath)) {
      recordClaimSkipped()
      scheduleDeferredWakeClaim(event, signal)
      return
    }
    claimingStreamPaths.add(streamPath)
    try {
      const notification = await claimWake(event, signal)
      if (!notification) return
      if (!isRunningState() || signal.aborted) {
        return
      }
      try {
        config.runtime.dispatchWake(notification, {
          claimHeaders: resolveClaimHeaders,
          claimTokenHeader: config.claimTokenHeader,
        })
      } catch (err) {
        reportError(err)
        notifyHeartbeatChange()
        return
      }
      lastDispatchAt = new Date().toISOString()
      notifyHeartbeatChange()
    } catch (err) {
      if (!signal.aborted) {
        reportError(err)
      }
    } finally {
      claimingStreamPaths.delete(streamPath)
    }
  }

  const spawnClaimActor = (event: PullWakeEvent, signal: AbortSignal): void => {
    let claim: Promise<void>
    claim = claimAndDispatch(event, signal).finally(() => {
      claimActors.delete(claim)
    })
    claimActors.add(claim)
  }

  const waitForClaimActors = async (
    timeoutMs = CLAIM_ACTOR_STOP_GRACE_MS
  ): Promise<boolean> => {
    const deadline = Date.now() + timeoutMs
    while (claimActors.size > 0) {
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) return false
      const result = await new Promise<`settled` | `timeout`>((resolve) => {
        const timer = setTimeout(() => resolve(`timeout`), remainingMs)
        void Promise.allSettled([...claimActors]).then(() => {
          clearTimeout(timer)
          resolve(`settled`)
        })
      })
      if (result === `timeout`) return false
    }
    return true
  }

  const machine = createPullWakeMachine({
    connectStream: async (signal) =>
      streamFactory({
        url: wakeUrl,
        headers: await resolveHeaders(),
        offset: currentOffset,
        signal,
      }),
    onStreamConnected: () => {
      streamConnectedSince = new Date().toISOString()
      notifyHeartbeatChange()
    },
    onStreamDisconnected: () => {
      streamConnectedSince = null
      notifyHeartbeatChange()
    },
    onWake: (event) => {
      eventsReceived++
      notifyHeartbeatChange()
      const signal = controller?.signal
      if (signal && !signal.aborted) scheduleDeferredWakeClaim(event, signal)
    },
    onOffset: (offset) => {
      if (offset !== currentOffset) {
        currentOffset = offset
        notifyHeartbeatChange()
      }
    },
    onReconnectError: (err) => {
      reconnectCount++
      reportError(err)
    },
    notifyHeartbeatChange,
    cancelResponse: (response, reason) => {
      response.cancel?.(reason)
    },
    onStopping: () => {
      controller?.abort()
      controller = null
      claimingStreamPaths.clear()
      clearDeferredWakeRetries()
      stopHeartbeat()
    },
    shutdown: async () => {
      if (!(await waitForClaimActors())) {
        claimActors.clear()
        claimingStreamPaths.clear()
        clearDeferredWakeRetries()
      }
      config.runtime.abortWakes()
      try {
        await config.runtime.drainWakes()
      } catch (err) {
        reportError(err)
        throw err
      }
    },
  })

  const actor = createActor(machine)
  actor.start()

  const waitForStoppedState = (): Promise<void> =>
    new Promise((resolve) => {
      if (actor.getSnapshot().matches(`stopped`)) return resolve()
      const subscription = actor.subscribe((snapshot) => {
        if (snapshot.matches(`stopped`)) {
          subscription.unsubscribe()
          resolve()
        }
      })
    })

  return {
    start() {
      if (!actor.getSnapshot().matches(`stopped`) || stopPromise) return
      reconnectCount = 0
      lastError = null
      lastErrorAt = null
      lastHeartbeatAt = null
      lastHeartbeatOk = false
      lastClaimAt = null
      lastClaimResult = null
      lastDispatchAt = null
      eventsReceived = 0
      claimsSucceeded = 0
      claimsSkipped = 0
      claimsFailed = 0
      consecutiveHeartbeatFailures = 0
      claimingStreamPaths.clear()
      clearDeferredWakeRetries()
      startedAt = new Date().toISOString()
      controller = new AbortController()
      startHeartbeat(controller.signal)
      actor.send({ type: `START` })
    },
    async stop() {
      if (stopPromise) return stopPromise
      if (actor.getSnapshot().matches(`stopped`)) return
      stopPromise = (async () => {
        actor.send({ type: `STOP` })
        await waitForStoppedState()
        const { drainError } = actor.getSnapshot().context
        if (drainError) throw drainError
      })().finally(() => {
        stopPromise = null
      })
      return stopPromise
    },
    async waitForStopped() {
      if (stopPromise) {
        await stopPromise
        return
      }
      await waitForStoppedState()
    },
    get running() {
      return isRunningState()
    },
    get offset() {
      return currentOffset
    },
    getHealth(): PullWakeRunnerHealth {
      return {
        running: isRunningState(),
        offset: currentOffset,
        ...buildDiagnostics(),
      }
    },
  }
}
