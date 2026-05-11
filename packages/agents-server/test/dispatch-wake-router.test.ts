import { describe, expect, it, vi } from 'vitest'
import {
  DispatchWakeRouter,
  redactWakeNotification,
} from '../src/dispatch-wake-router'
import type { StreamClient } from '../src/stream-client'
import type { WakeNotification } from '@electric-ax/agents-runtime'

function makeNotification(): WakeNotification {
  return {
    consumerId: `entity:chat:one`,
    epoch: 1,
    wakeId: `wake-1`,
    streamPath: `/chat/one/main`,
    streams: [{ path: `/chat/one/main`, offset: `7` }],
    triggeredBy: [`append`],
    callback: `https://durable.test/callback`,
    claimToken: `claim-secret`,
    entity: {
      type: `chat`,
      status: `idle`,
      url: `/chat/one`,
      streams: { main: `/chat/one/main`, error: `/chat/one/error` },
      tags: { project: `demo` },
      spawnArgs: { prompt: `hello` },
    },
  }
}

function makeStreamClient() {
  return {
    append: vi.fn().mockResolvedValue({ offset: `42` }),
  } as unknown as StreamClient & {
    append: ReturnType<typeof vi.fn>
  }
}

describe(`DispatchWakeRouter`, () => {
  it(`does not deliver when materialization coalesces an active or outstanding wake`, async () => {
    const streamClient = makeStreamClient()
    const fetchImpl = vi.fn()
    const router = new DispatchWakeRouter({
      streamClient,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      materializeWake: vi.fn().mockResolvedValue({
        status: `coalesced`,
        wakeId: `wake-existing`,
        reason: `active-claim`,
      }),
    })

    const result = await router.dispatchToTarget(
      { type: `webhook`, url: `https://handler.test/wake` },
      makeNotification()
    )

    expect(result).toEqual({
      target: { type: `webhook`, url: `https://handler.test/wake` },
      status: `coalesced`,
      wakeId: `wake-existing`,
      reason: `active-claim`,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(streamClient.append).not.toHaveBeenCalled()
  })

  it(`uses the runner row wake_stream instead of deriving runner wake paths`, async () => {
    const streamClient = makeStreamClient()
    const materializeWake = vi.fn().mockResolvedValue({ status: `queued` })
    const router = new DispatchWakeRouter({
      streamClient,
      registry: {
        getEntity: vi.fn(),
        getEntityByStream: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `runner-1`,
          owner_user_id: `user-1`,
          label: `Runner 1`,
          kind: `local`,
          admin_status: `enabled`,
          wake_stream: `/custom/runner-1/wake`,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        }),
      },
      materializeWake,
    })

    const result = await router.dispatchToTarget(
      { type: `runner`, runnerId: `runner-1` },
      makeNotification()
    )

    expect(streamClient.append).toHaveBeenCalledWith(
      `/custom/runner-1/wake`,
      JSON.stringify(makeNotification())
    )
    expect(materializeWake).toHaveBeenCalledWith(
      expect.objectContaining({
        runnerWakeStream: `/custom/runner-1/wake`,
        runner: expect.objectContaining({ id: `runner-1` }),
      })
    )
    expect(result).toEqual({
      target: { type: `runner`, runnerId: `runner-1` },
      status: `queued`,
      runnerWakeStream: `/custom/runner-1/wake`,
      runnerWakeStreamOffset: `42`,
    })
  })

  it(`rejects disabled runner targets before materialization or append`, async () => {
    const streamClient = makeStreamClient()
    const materializeWake = vi.fn()
    const router = new DispatchWakeRouter({
      streamClient,
      registry: {
        getEntity: vi.fn(),
        getEntityByStream: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `runner-1`,
          owner_user_id: `user-1`,
          label: `Runner 1`,
          kind: `local`,
          admin_status: `disabled`,
          wake_stream: `/custom/runner-1/wake`,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        }),
      },
      materializeWake,
    })

    await expect(
      router.dispatchToTarget(
        { type: `runner`, runnerId: `runner-1` },
        makeNotification()
      )
    ).rejects.toThrow(`Dispatch runner "runner-1" is disabled`)
    expect(materializeWake).not.toHaveBeenCalled()
    expect(streamClient.append).not.toHaveBeenCalled()
  })

  it(`redacts callback and claim/write tokens before materialization`, async () => {
    const notification = {
      ...makeNotification(),
      writeToken: `wake-write-secret`,
      entity: {
        ...makeNotification().entity!,
        writeToken: `entity-write-secret`,
      },
    } as WakeNotification & {
      writeToken?: string
      entity: NonNullable<WakeNotification[`entity`]> & { writeToken?: string }
    }
    const publicNotification = redactWakeNotification(notification)

    expect(publicNotification).not.toHaveProperty(`callback`)
    expect(publicNotification).not.toHaveProperty(`claimToken`)
    expect(publicNotification).not.toHaveProperty(`writeToken`)
    expect(publicNotification.entity).not.toHaveProperty(`writeToken`)

    const materializeWake = vi.fn().mockResolvedValue({ status: `coalesced` })
    const router = new DispatchWakeRouter({
      streamClient: makeStreamClient(),
      fetchImpl: vi.fn() as unknown as typeof fetch,
      materializeWake,
    })

    await router.dispatchToTarget(
      { type: `webhook`, url: `https://handler.test/wake` },
      notification
    )

    expect(materializeWake).toHaveBeenCalledWith(
      expect.objectContaining({ notificationPublic: publicNotification })
    )
  })
  it(`posts webhook notifications without write tokens`, async () => {
    const notification = {
      ...makeNotification(),
      writeToken: `wake-write-secret`,
      entity: {
        ...makeNotification().entity!,
        writeToken: `entity-write-secret`,
      },
    } as WakeNotification & {
      writeToken?: string
      entity: NonNullable<WakeNotification[`entity`]> & { writeToken?: string }
    }
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }))
    const markWakeDelivered = vi.fn().mockResolvedValue(undefined)
    const router = new DispatchWakeRouter({
      streamClient: makeStreamClient(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      materializeWake: vi.fn().mockResolvedValue({ status: `queued` }),
      markWakeDelivered,
    })

    await expect(
      router.dispatchToTarget(
        { type: `webhook`, url: `https://handler.test/wake` },
        notification
      )
    ).resolves.toEqual({
      target: { type: `webhook`, url: `https://handler.test/wake` },
      status: `delivered`,
    })

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(init.body)) as Record<string, unknown> & {
      entity?: Record<string, unknown>
    }
    expect(body).not.toHaveProperty(`writeToken`)
    expect(body.entity).not.toHaveProperty(`writeToken`)
    expect(body).toMatchObject({
      callback: `https://durable.test/callback`,
      claimToken: `claim-secret`,
    })
    expect(markWakeDelivered).toHaveBeenCalledWith({
      wakeId: `wake-1`,
      target: { type: `webhook`, url: `https://handler.test/wake` },
    })
  })

  it(`marks webhook delivery failed on non-2xx responses`, async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(`nope`, { status: 500 }))
    const markWakeFailed = vi.fn().mockResolvedValue(undefined)
    const router = new DispatchWakeRouter({
      streamClient: makeStreamClient(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      materializeWake: vi.fn().mockResolvedValue({ status: `queued` }),
      markWakeFailed,
    })

    await expect(
      router.dispatchToTarget(
        { type: `webhook`, url: `https://handler.test/wake` },
        makeNotification()
      )
    ).rejects.toThrow(`Dispatch wake webhook failed: 500 nope`)
    expect(markWakeFailed).toHaveBeenCalledWith({
      wakeId: `wake-1`,
      target: { type: `webhook`, url: `https://handler.test/wake` },
      error: expect.any(Error),
    })
  })

  it(`rejects missing runner targets before materialization or append`, async () => {
    const streamClient = makeStreamClient()
    const materializeWake = vi.fn()
    const router = new DispatchWakeRouter({
      streamClient,
      registry: {
        getEntity: vi.fn(),
        getEntityByStream: vi.fn(),
        getRunner: vi.fn().mockResolvedValue(null),
      },
      materializeWake,
    })

    await expect(
      router.dispatchToTarget(
        { type: `runner`, runnerId: `missing-runner` },
        makeNotification()
      )
    ).rejects.toThrow(`Dispatch runner "missing-runner" was not found`)
    expect(materializeWake).not.toHaveBeenCalled()
    expect(streamClient.append).not.toHaveBeenCalled()
  })

  it(`rejects runner targets without wake streams before materialization or append`, async () => {
    const streamClient = makeStreamClient()
    const materializeWake = vi.fn()
    const router = new DispatchWakeRouter({
      streamClient,
      registry: {
        getEntity: vi.fn(),
        getEntityByStream: vi.fn(),
        getRunner: vi.fn().mockResolvedValue({
          id: `runner-1`,
          owner_user_id: `user-1`,
          label: `Runner 1`,
          kind: `local`,
          admin_status: `enabled`,
          wake_stream: ``,
          created_at: new Date(0).toISOString(),
          updated_at: new Date(0).toISOString(),
        }),
      },
      materializeWake,
    })

    await expect(
      router.dispatchToTarget(
        { type: `runner`, runnerId: `runner-1` },
        makeNotification()
      )
    ).rejects.toThrow(`Dispatch runner "runner-1" has no wake stream`)
    expect(materializeWake).not.toHaveBeenCalled()
    expect(streamClient.append).not.toHaveBeenCalled()
  })
})
