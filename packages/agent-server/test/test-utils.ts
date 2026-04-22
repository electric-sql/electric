import { stream } from '@durable-streams/client'

const debugTestTiming = process.env.ELECTRIC_AGENTS_DEBUG_TEST_TIMING === `1`

export async function timeStep<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const start = performance.now()
  try {
    return await fn()
  } finally {
    if (debugTestTiming) {
      console.info(
        `[agent-server-test-timing] ${label}: ${(performance.now() - start).toFixed(1)}ms`
      )
    }
  }
}

export async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  pollMs = 25
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }
  throw new Error(`Timed out after ${timeoutMs}ms`)
}

export async function readStreamEvents(
  baseUrl: string,
  streamPath: string
): Promise<Array<Record<string, unknown>>> {
  const res = await stream<Record<string, unknown>>({
    url: `${baseUrl}${streamPath}`,
    offset: `-1`,
    live: false,
  })
  return await res.json()
}

export async function waitForStreamEvents(
  baseUrl: string,
  streamPath: string,
  predicate: (events: Array<Record<string, unknown>>) => boolean,
  timeoutMs = 5_000
): Promise<Array<Record<string, unknown>>> {
  const res = await stream<Record<string, unknown>>({
    url: `${baseUrl}${streamPath}`,
    offset: `-1`,
    live: `long-poll`,
  })

  return await new Promise<Array<Record<string, unknown>>>(
    (resolve, reject) => {
      const events: Array<Record<string, unknown>> = []
      let done = false

      const cleanup = (): void => {
        if (done) return
        done = true
        clearTimeout(timeout)
        unsubscribe()
        res.cancel(`done`)
      }

      const finishSuccess = (value: Array<Record<string, unknown>>): void => {
        cleanup()
        resolve(value)
      }

      const finishError = (error: Error): void => {
        cleanup()
        reject(error)
      }

      const timeout = setTimeout(() => {
        finishError(
          new Error(
            `Timed out waiting for matching events on ${streamPath} after ${timeoutMs}ms`
          )
        )
      }, timeoutMs)

      const unsubscribe = res.subscribeJson((batch) => {
        events.push(...(batch.items as Array<Record<string, unknown>>))
        if (predicate(events)) {
          finishSuccess([...events])
        }
      })

      void res.closed.catch((error) => {
        if (!done) {
          finishError(error)
        }
      })
    }
  )
}
