import { DurableStream } from '@durable-streams/client'
import type { RuntimeRouter } from './create-handler'
import type { ProcessWakeConfig, WakeNotification } from './types'

export interface PullWakeRunnerConfig {
  /** Base URL of the durable streams / agents server. */
  baseUrl: string
  /** Runner id whose wake stream should be tailed. */
  runnerId: string
  /** Runtime/router that processes acquired entity wakes. */
  runtime: Pick<RuntimeRouter, `dispatchWake` | `drainWakes` | `abortWakes`>
  /** Resume offset for the runner wake stream. Defaults to start of stream. */
  offset?: string
  /** Headers sent when tailing the runner wake stream/registering control-plane calls. */
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>)
  /**
   * Headers sent to entity claim callbacks. Usually carries user/session auth.
   * Electric-Runner-Id defaults to runnerId and is added unless overridden.
   */
  claimHeaders?: ProcessWakeConfig[`claimHeaders`]
  /** Header transport for the Durable Streams claim token during acquire. */
  claimTokenHeader?: ProcessWakeConfig[`claimTokenHeader`]
  /** Wake stream path. Defaults to /runners/{runnerId}/wake. */
  wakeStreamPath?: string
  /** Heartbeat interval for runner liveness. Set <= 0 to disable. Defaults to 30s. */
  heartbeatIntervalMs?: number
  /** Lease duration requested with each heartbeat. Defaults to 3x heartbeatIntervalMs. */
  leaseMs?: number
  /** Runner heartbeat path. Defaults to /_electric/runners/{runnerId}/heartbeat. */
  heartbeatPath?: string
  /** Optional lifecycle error hook. Return true to mark handled. */
  onError?: (error: Error) => boolean | void
  /** Test seam for custom stream implementations. */
  streamFactory?: (opts: {
    url: string
    headers?: Record<string, string> | (() => Promise<Record<string, string>>)
    offset?: string
    signal: AbortSignal
  }) => Promise<PullWakeStreamResponse>
}

export interface PullWakeStreamResponse {
  jsonStream: () => AsyncIterable<WakeNotification>
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
  const heartbeatIntervalMs = config.heartbeatIntervalMs ?? 30_000
  const leaseMs = config.leaseMs ?? heartbeatIntervalMs * 3
  const heartbeatPath =
    config.heartbeatPath ??
    `/_electric/runners/${encodeURIComponent(config.runnerId)}/heartbeat`
  const heartbeatUrl = new URL(heartbeatPath, config.baseUrl).toString()

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
        body: JSON.stringify({ lease_ms: leaseMs }),
        signal,
      })
      if (!res.ok) {
        throw new Error(
          `Pull-wake runner heartbeat failed for ${config.runnerId}: ${res.status} ${await res.text()}`
        )
      }
    } catch (err) {
      if (!signal.aborted) {
        const error = err instanceof Error ? err : new Error(String(err))
        try {
          config.onError?.(error)
        } catch {
          // Heartbeat errors should not kill the wake tail.
        }
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
      return (await stream.stream<WakeNotification>({
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

  const run = async (): Promise<void> => {
    const signal = controller!.signal
    try {
      response = await streamFactory({
        url: wakeUrl,
        headers: resolveHeaders,
        offset: currentOffset,
        signal,
      })
      for await (const notification of response.jsonStream()) {
        if (signal.aborted) break
        config.runtime.dispatchWake(notification, {
          claimHeaders: resolveClaimHeaders,
          claimTokenHeader: config.claimTokenHeader,
        })
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
