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
  leaseMs?: number
  heartbeatPath?: string
  claimPath?: string
  onError?: (error: Error) => boolean | void
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

export interface PullWakeRunnerHealth {
  running: boolean
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

export function createPullWakeRunner(
  config: PullWakeRunnerConfig
): PullWakeRunner {
  let controller: AbortController | null = null
  let loop: Promise<void> | null = null
  let response: PullWakeStreamResponse | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
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

  const wakePath =
    config.wakeStreamPath ??
    `/runners/${encodeURIComponent(config.runnerId)}/wake`
  const wakeUrl = appendPathToUrl(config.baseUrl, wakePath)
  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS
  const leaseMs = config.leaseMs ?? heartbeatIntervalMs * 3
  const heartbeatPath =
    config.heartbeatPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/heartbeat`
  const heartbeatUrl = appendPathToUrl(config.baseUrl, heartbeatPath)
  const claimPath =
    config.claimPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/claim`
  const claimUrl = appendPathToUrl(config.baseUrl, claimPath)

  const buildDiagnostics = (): Omit<
    PullWakeRunnerHealth,
    `running` | `offset`
  > => ({
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
    if (config.onError?.(error) !== true) throw error
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
        config.onError?.(err instanceof Error ? err : new Error(String(err)))
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
          config.onError?.(error)
          return {}
        },
      })) as PullWakeStreamResponse
    })

  const claimWake = async (
    event: PullWakeEvent,
    signal: AbortSignal
  ): Promise<WakeNotification | null> => {
    lastClaimAt = new Date().toISOString()
    lastClaimResult = null
    const headers = new Headers(await resolveHeaders())
    headers.set(`content-type`, `application/json`)
    try {
      const response = await fetch(claimUrl, {
        method: `POST`,
        headers,
        signal,
        body: JSON.stringify(event),
      })
      if (response.status === 204) {
        lastClaimResult = `no_work`
        claimsSkipped++
        return null
      }
      if (!response.ok) {
        const text = await response.text()
        if (
          response.status === 409 &&
          (text.includes(`ALREADY_CLAIMED`) || text.includes(`NO_PENDING_WORK`))
        ) {
          lastClaimResult = `no_work`
          claimsSkipped++
          return null
        }
        lastClaimResult = `error`
        claimsFailed++
        throw new Error(
          `Pull-wake claim failed for ${config.runnerId}: ${response.status} ${text}`
        )
      }
      const notification = (await response.json()) as WakeNotification & {
        done?: boolean
      }
      if (notification.done) {
        lastClaimResult = `no_work`
        claimsSkipped++
        return null
      }
      lastClaimResult = `claimed`
      claimsSucceeded++
      return notification
    } catch (err) {
      if (lastClaimResult !== `no_work` && lastClaimResult !== `error`) {
        lastClaimResult = `error`
        claimsFailed++
      }
      throw err
    }
  }

  const run = async (): Promise<void> => {
    const signal = controller!.signal
    try {
      response = await streamFactory({
        url: wakeUrl,
        headers: await resolveHeaders(),
        offset: currentOffset,
        signal,
      })
      streamConnected = true
      streamConnectedSince = new Date().toISOString()
      for await (const event of response.jsonStream()) {
        if (signal.aborted) break
        if (event?.type !== `wake`) continue
        eventsReceived++
        const notification = await claimWake(event, signal)
        if (notification) {
          config.runtime.dispatchWake(notification, {
            claimHeaders: resolveClaimHeaders,
            claimTokenHeader: config.claimTokenHeader,
          })
          lastDispatchAt = new Date().toISOString()
          await config.runtime.drainWakes()
        }
        if (response.offset !== undefined) currentOffset = response.offset
      }
      await response.closed?.catch((err) => {
        if (!signal.aborted) throw err
      })
    } catch (err) {
      if (!signal.aborted) {
        reconnectCount++
        reportError(err)
      }
    } finally {
      streamConnected = false
      stopHeartbeat()
      response = null
      controller = null
    }
  }

  return {
    start() {
      if (loop) return
      controller = new AbortController()
      startedAt = new Date().toISOString()
      startHeartbeat(controller.signal)
      loop = run().finally(() => {
        loop = null
      })
    },
    async stop() {
      controller?.abort()
      stopHeartbeat()
      response?.cancel?.(new Error(`pull wake runner stopped`))
      config.runtime.abortWakes()
      await loop?.catch((err) => {
        if (!(err instanceof Error && err.name === `AbortError`)) throw err
      })
      await config.runtime.drainWakes()
    },
    async waitForStopped() {
      await loop
    },
    get running() {
      return loop !== null
    },
    get offset() {
      return currentOffset
    },
    getHealth(): PullWakeRunnerHealth {
      return {
        running: loop !== null,
        offset: currentOffset,
        ...buildDiagnostics(),
      }
    },
  }
}
