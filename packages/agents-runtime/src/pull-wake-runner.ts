import { DurableStream } from '@durable-streams/client'
import { DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS } from './constants'
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
  runtime: Pick<RuntimeRouter, `dispatchWake` | `drainWakes` | `abortWakes`>
  offset?: string
  headers?: HeadersProvider
  claimHeaders?: ProcessWakeConfig[`claimHeaders`]
  claimTokenHeader?: ProcessWakeConfig[`claimTokenHeader`]
  wakeStreamPath?: string
  heartbeatIntervalMs?: number
  eventHeartbeatThrottleMs?: number
  leaseMs?: number
  maxConcurrentClaims?: number
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

type PullWakeRunnerState =
  | `stopped`
  | `starting`
  | `running.connecting`
  | `running.streaming`
  | `running.reconnecting`
  | `stopping`

const DEFAULT_MAX_CONCURRENT_CLAIMS = 10
const INITIAL_RECONNECT_BACKOFF_MS = 1_000
const MAX_RECONNECT_BACKOFF_MS = 30_000
const CLAIM_ACTOR_STOP_GRACE_MS = 1_000
const DEFAULT_EVENT_HEARTBEAT_THROTTLE_MS = 2_000

export function createPullWakeRunner(
  config: PullWakeRunnerConfig
): PullWakeRunner {
  let state: PullWakeRunnerState = `stopped`
  let controller: AbortController | null = null
  let loop: Promise<void> | null = null
  let response: PullWakeStreamResponse | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let eventHeartbeatTimer: ReturnType<typeof setTimeout> | null = null
  let currentOffset = config.offset
  let startedAt: string | null = null
  let streamConnected = false
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
  let acceptingClaims = false
  let activeClaimCount = 0
  let runGeneration = 0
  let nextReconnectBackoffMs = INITIAL_RECONNECT_BACKOFF_MS
  const claimActors = new Map<Promise<void>, number>()

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
  const maxConcurrentClaims = Math.max(
    1,
    Math.floor(config.maxConcurrentClaims ?? DEFAULT_MAX_CONCURRENT_CLAIMS)
  )

  const toStatus = (): PullWakeRunnerStatus => {
    switch (state) {
      case `stopped`:
        return `stopped`
      case `starting`:
        return `starting`
      case `running.connecting`:
        return `connecting`
      case `running.streaming`:
        return `streaming`
      case `running.reconnecting`:
        return `reconnecting`
      case `stopping`:
        return `stopping`
    }
  }

  const buildDiagnostics = (): Omit<
    PullWakeRunnerHealth,
    `running` | `offset`
  > => ({
    status: toStatus(),
    started_at: startedAt,
    stream_connected: streamConnected,
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
    if (!signal || signal.aborted || heartbeatIntervalMs <= 0) return
    if (eventHeartbeatTimer) return
    eventHeartbeatTimer = setTimeout(() => {
      eventHeartbeatTimer = null
      void heartbeat(signal)
    }, eventHeartbeatThrottleMs)
  }

  const heartbeat = async (signal: AbortSignal): Promise<void> => {
    try {
      const headers = new Headers(await resolveHeaders())
      headers.set(`content-type`, `application/json`)
      const res = await fetch(heartbeatUrl, {
        method: `POST`,
        headers,
        body: JSON.stringify({
          lease_ms: leaseMs,
          ...(currentOffset !== undefined
            ? { wake_stream_offset: currentOffset }
            : {}),
          diagnostics: buildDiagnostics(),
        }),
        signal,
      })
      lastHeartbeatAt = new Date().toISOString()
      if (!res.ok) {
        lastHeartbeatOk = false
        throw new Error(
          `Pull-wake runner heartbeat failed for ${config.runnerId}: ${res.status} ${await res.text()}`
        )
      }
      lastHeartbeatOk = true
    } catch (err) {
      if (!signal.aborted) {
        lastHeartbeatOk = false
        reportError(err)
      }
    }
  }

  const startHeartbeat = (signal: AbortSignal): void => {
    if (heartbeatIntervalMs <= 0) return
    void heartbeat(signal)
    heartbeatTimer = setInterval(() => {
      void heartbeat(signal)
    }, heartbeatIntervalMs)
  }

  const stopHeartbeat = (): void => {
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

  const isRunningState = (): boolean =>
    state === `starting` || state.startsWith(`running.`)

  const waitForClaimCapacity = async (
    signal: AbortSignal
  ): Promise<boolean> => {
    const abortPromise = new Promise<void>((resolve) => {
      if (signal.aborted) {
        resolve()
        return
      }
      signal.addEventListener(`abort`, () => resolve(), { once: true })
    })

    while (
      acceptingClaims &&
      !signal.aborted &&
      activeClaimCount >= maxConcurrentClaims
    ) {
      const inFlight = [...claimActors.keys()]
      if (inFlight.length === 0) return true
      await Promise.race([...inFlight, abortPromise]).catch(() => undefined)
    }
    return acceptingClaims && !signal.aborted
  }

  const claimAndDispatch = async (
    event: PullWakeEvent,
    signal: AbortSignal
  ): Promise<void> => {
    try {
      const notification = await claimWake(event, signal)
      if (!notification) return
      if (!acceptingClaims || signal.aborted) {
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
    }
  }

  const spawnClaimActor = (
    event: PullWakeEvent,
    signal: AbortSignal,
    generation: number
  ): void => {
    activeClaimCount++
    let actor: Promise<void>
    actor = claimAndDispatch(event, signal).finally(() => {
      if (claimActors.get(actor) === generation) {
        activeClaimCount--
      }
      claimActors.delete(actor)
    })
    claimActors.set(actor, generation)
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
        void Promise.allSettled([...claimActors.keys()]).then(() => {
          clearTimeout(timer)
          resolve(`settled`)
        })
      })
      if (result === `timeout`) return false
    }
    return true
  }

  const sleep = async (ms: number, signal: AbortSignal): Promise<void> => {
    if (ms <= 0 || signal.aborted) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      signal.addEventListener(
        `abort`,
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })
  }

  const consumeWakeStream = async (
    signal: AbortSignal,
    generation: number
  ): Promise<void> => {
    response = await streamFactory({
      url: wakeUrl,
      headers: await resolveHeaders(),
      offset: currentOffset,
      signal,
    })
    state = `running.streaming`
    streamConnected = true
    streamConnectedSince = new Date().toISOString()
    nextReconnectBackoffMs = INITIAL_RECONNECT_BACKOFF_MS
    notifyHeartbeatChange()

    try {
      for await (const event of response.jsonStream()) {
        if (signal.aborted) break
        if (event?.type === `wake`) {
          eventsReceived++
          notifyHeartbeatChange()
          if (await waitForClaimCapacity(signal)) {
            spawnClaimActor(event, signal, generation)
          } else {
            claimsSkipped++
            notifyHeartbeatChange()
          }
        }
        if (response.offset !== undefined) {
          currentOffset = response.offset
          notifyHeartbeatChange()
        }
      }
      await response.closed?.catch((err) => {
        if (!signal.aborted) throw err
      })
    } finally {
      streamConnected = false
      streamConnectedSince = null
      response = null
      if (!signal.aborted) notifyHeartbeatChange()
    }
  }

  const run = async (): Promise<void> => {
    const signal = controller!.signal
    acceptingClaims = true
    try {
      while (!signal.aborted) {
        state = `running.connecting`
        notifyHeartbeatChange()
        try {
          await consumeWakeStream(signal, runGeneration)
          if (!signal.aborted) {
            state = `running.reconnecting`
            notifyHeartbeatChange()
            const backoffMs = nextReconnectBackoffMs
            nextReconnectBackoffMs = Math.min(
              nextReconnectBackoffMs * 2,
              MAX_RECONNECT_BACKOFF_MS
            )
            await sleep(backoffMs, signal)
          }
        } catch (err) {
          if (!signal.aborted) {
            reconnectCount++
            reportError(err)
            state = `running.reconnecting`
            notifyHeartbeatChange()
            const backoffMs = nextReconnectBackoffMs
            nextReconnectBackoffMs = Math.min(
              nextReconnectBackoffMs * 2,
              MAX_RECONNECT_BACKOFF_MS
            )
            await sleep(backoffMs, signal)
          }
        }
      }
    } finally {
      acceptingClaims = false
      streamConnected = false
      streamConnectedSince = null
      response = null
      controller = null
      if (state !== `stopping`) state = `stopped`
    }
  }

  return {
    start() {
      if (loop) return
      state = `starting`
      controller = new AbortController()
      runGeneration++
      startedAt = new Date().toISOString()
      startHeartbeat(controller.signal)
      loop = run().finally(() => {
        loop = null
        stopHeartbeat()
      })
    },
    async stop() {
      if (state === `stopped`) return
      state = `stopping`
      acceptingClaims = false
      controller?.abort()
      stopHeartbeat()
      response?.cancel?.(new Error(`pull wake runner stopped`))
      if (!(await waitForClaimActors())) {
        claimActors.clear()
        activeClaimCount = 0
      }
      config.runtime.abortWakes()
      await loop?.catch((err) => {
        if (!(err instanceof Error && err.name === `AbortError`)) throw err
      })
      let drainError: unknown
      try {
        await config.runtime.drainWakes()
      } catch (err) {
        reportError(err)
        drainError = err
      } finally {
        state = `stopped`
      }
      if (drainError) throw drainError
    },
    async waitForStopped() {
      await loop
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
