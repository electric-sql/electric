import { describe, expect, it, vi } from 'vitest'
import { createPullWakeRunner } from '../src/pull-wake-runner'
import type { WakeNotification } from '../src/types'

function notification(id: string): WakeNotification {
  return {
    consumerId: `consumer`,
    epoch: 1,
    wakeId: id,
    streamPath: `/entities/example`,
    streams: [{ path: `/entities/example`, offset: `1` }],
    callback: `http://localhost/callback`,
    claimToken: `claim`,
    entity: {
      type: `example`,
      status: `pending`,
      url: `http://localhost/entities/example`,
      streams: { main: `/entities/example`, error: `/entities/example/error` },
    },
  }
}

describe(`createPullWakeRunner`, () => {
  it(`tails the runner wake stream and dispatches wake notifications`, async () => {
    const dispatched: Array<WakeNotification> = []
    const runtime = {
      dispatchWake: vi.fn((wake: WakeNotification) => dispatched.push(wake)),
      drainWakes: vi.fn(async () => {}),
      abortWakes: vi.fn(),
    }

    let offset = `0`
    const wakes = [notification(`wake-1`), notification(`wake-2`)]
    const streamFactory = vi.fn(async () => ({
      get offset() {
        return offset
      },
      jsonStream: async function* () {
        for (const wake of wakes) {
          offset = wake.wakeId
          yield wake
        }
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://localhost:3000`,
      runnerId: `runner a/b`,
      runtime,
      offset: `initial`,
      streamFactory,
    })

    runner.start()
    await runner.waitForStopped()

    expect(streamFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `http://localhost:3000/runners/runner%20a%2Fb/wake`,
        offset: `initial`,
        signal: expect.any(AbortSignal),
      })
    )
    expect(dispatched.map((wake) => wake.wakeId)).toEqual([`wake-1`, `wake-2`])
    expect(runner.offset).toBe(`wake-2`)
    expect(runner.running).toBe(false)
  })

  it(`passes claim headers with default runner id when dispatching wakes`, async () => {
    const runtime = {
      dispatchWake: vi.fn(),
      drainWakes: vi.fn(async () => {}),
      abortWakes: vi.fn(),
    }

    const runner = createPullWakeRunner({
      baseUrl: `http://localhost:3000`,
      runnerId: `runner-1`,
      runtime,
      claimHeaders: () => ({ authorization: `Bearer user-session` }),
      claimTokenHeader: `electric-claim-token`,
      streamFactory: async () => ({
        jsonStream: async function* () {
          yield notification(`wake-1`)
        },
        closed: Promise.resolve(),
      }),
    })

    runner.start()
    await runner.waitForStopped()

    expect(runtime.dispatchWake).toHaveBeenCalledTimes(1)
    const [, options] = runtime.dispatchWake.mock.calls[0]!
    const claimHeaders = new Headers(await options.claimHeaders())
    expect(claimHeaders.get(`authorization`)).toBe(`Bearer user-session`)
    expect(claimHeaders.get(`electric-runner-id`)).toBe(`runner-1`)
    expect(options.claimTokenHeader).toBe(`electric-claim-token`)
  })

  it(`does not start duplicate wake tails`, async () => {
    const runtime = {
      dispatchWake: vi.fn(),
      drainWakes: vi.fn(async () => {}),
      abortWakes: vi.fn(),
    }
    let release!: () => void
    const streamFactory = vi.fn(async () => ({
      jsonStream: async function* () {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      },
      closed: Promise.resolve(),
    }))

    const runner = createPullWakeRunner({
      baseUrl: `http://localhost:3000`,
      runnerId: `runner-1`,
      runtime,
      streamFactory,
    })

    runner.start()
    runner.start()
    await vi.waitFor(() => expect(streamFactory).toHaveBeenCalledTimes(1))
    release()
    await runner.waitForStopped()
  })

  it(`stop aborts the wake tail, aborts in-flight wakes, and drains runtime`, async () => {
    let signal: AbortSignal | undefined
    let cancel: ((reason?: unknown) => void) | undefined
    const runtime = {
      dispatchWake: vi.fn(),
      drainWakes: vi.fn(async () => {}),
      abortWakes: vi.fn(),
    }

    const runner = createPullWakeRunner({
      baseUrl: `http://localhost:3000`,
      runnerId: `runner-1`,
      runtime,
      streamFactory: async (opts) => {
        signal = opts.signal
        return {
          jsonStream: async function* () {
            await new Promise<void>((resolve) => {
              cancel = () => resolve()
            })
          },
          cancel: (reason?: unknown) => cancel?.(reason),
          closed: Promise.resolve(),
        }
      },
    })

    runner.start()
    await vi.waitFor(() => expect(signal).toBeDefined())
    await runner.stop()

    expect(signal?.aborted).toBe(true)
    expect(runtime.abortWakes).toHaveBeenCalledTimes(1)
    expect(runtime.drainWakes).toHaveBeenCalledTimes(1)
    expect(runner.running).toBe(false)
  })
})
