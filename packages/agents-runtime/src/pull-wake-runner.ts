import { DurableStream } from '@durable-streams/client'
import { DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS } from './constants'
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
    headers?: Record<string, string> | (() => Promise<Record<string, string>>)
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
}

export function createPullWakeRunner(
  config: PullWakeRunnerConfig
): PullWakeRunner {
  let controller: AbortController | null = null
  let loop: Promise<void> | null = null
  let response: PullWakeStreamResponse | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let currentOffset = config.offset

  const wakePath =
    config.wakeStreamPath ??
    `/runners/${encodeURIComponent(config.runnerId)}/wake`
  const wakeUrl = new URL(wakePath, config.baseUrl).toString()
  const heartbeatIntervalMs =
    config.heartbeatIntervalMs ?? DEFAULT_RUNNER_HEARTBEAT_INTERVAL_MS
  const leaseMs = config.leaseMs ?? heartbeatIntervalMs * 3
  const heartbeatPath =
    config.heartbeatPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/heartbeat`
  const heartbeatUrl = new URL(heartbeatPath, config.baseUrl).toString()
  const claimPath =
    config.claimPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/claim`
  const claimUrl = new URL(claimPath, config.baseUrl).toString()

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
        }),
        signal,
      })
      if (!res.ok) {
        throw new Error(
          `Pull-wake runner heartbeat failed for ${config.runnerId}: ${res.status} ${await res.text()}`
        )
      }
    } catch (err) {
      if (!signal.aborted) {
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
    const headers = new Headers(await resolveHeaders())
    headers.set(`content-type`, `application/json`)
    const response = await fetch(claimUrl, {
      method: `POST`,
      headers,
      signal,
      body: JSON.stringify(event),
    })
    if (response.status === 204) return null
    if (!response.ok) {
      const text = await response.text()
      if (
        response.status === 409 &&
        (text.includes(`ALREADY_CLAIMED`) || text.includes(`NO_PENDING_WORK`))
      ) {
        return null
      }
      throw new Error(
        `Pull-wake claim failed for ${config.runnerId}: ${response.status} ${text}`
      )
    }
    const notification = (await response.json()) as WakeNotification & {
      done?: boolean
    }
    if (notification.done) return null
    return notification
  }

  const run = async (): Promise<void> => {
    const signal = controller!.signal
    try {
      response = await streamFactory({
        url: wakeUrl,
        headers: resolveHeaders,
        offset: currentOffset,
        signal,
      })
      for await (const event of response.jsonStream()) {
        if (signal.aborted) break
        if (event?.type !== `wake`) continue
        const notification = await claimWake(event, signal)
        if (notification) {
          config.runtime.dispatchWake(notification, {
            claimHeaders: resolveClaimHeaders,
            claimTokenHeader: config.claimTokenHeader,
          })
          await config.runtime.drainWakes()
        }
        if (response.offset !== undefined) currentOffset = response.offset
      }
      await response.closed?.catch((err) => {
        if (!signal.aborted) throw err
      })
    } catch (err) {
      if (!signal.aborted) {
        reportError(err)
      }
    } finally {
      stopHeartbeat()
      response = null
      controller = null
    }
  }

  return {
    start() {
      if (loop) return
      controller = new AbortController()
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
  }
}
