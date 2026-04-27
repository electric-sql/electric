import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsManager } from '../src/electric-agents-manager'
import { assertEntityStatus } from '../src/electric-agents-types'

describe(`assertEntityStatus`, () => {
  it(`returns valid statuses unchanged`, () => {
    expect(assertEntityStatus(`spawning`)).toBe(`spawning`)
    expect(assertEntityStatus(`running`)).toBe(`running`)
    expect(assertEntityStatus(`idle`)).toBe(`idle`)
    expect(assertEntityStatus(`stopped`)).toBe(`stopped`)
  })

  it(`throws on invalid status strings`, () => {
    expect(() => assertEntityStatus(`active`)).toThrow(`Invalid entity status`)
    expect(() => assertEntityStatus(`paused`)).toThrow(`Invalid entity status`)
    expect(() => assertEntityStatus(``)).toThrow(`Invalid entity status`)
  })
})

// =============================================================================
// Finding 4: spawn() leaks orphan wake registrations on materialize failure.
// =============================================================================
describe(`ElectricAgentsManager.spawn wake cleanup on failure`, () => {
  it(`unregisters wake if materializeEntity throws`, async () => {
    const registerWake = vi.fn().mockResolvedValue(undefined)
    const unregisterBySubscriberAndSource = vi.fn().mockResolvedValue(undefined)

    // streamClient.create will fail for the main stream,
    // which happens AFTER wake registration in spawn()
    const streamCreate = vi
      .fn()
      .mockRejectedValue(new Error(`stream create failed`))

    const manager = new ElectricAgentsManager({
      registry: {
        getEntityType: vi.fn().mockResolvedValue({
          name: `chat`,
          description: `test`,
          created_at: `2024-01-01`,
          updated_at: `2024-01-01`,
        }),
        getEntity: vi.fn().mockResolvedValue(null),
      } as any,
      streamClient: {
        create: streamCreate,
        append: vi.fn().mockResolvedValue({ offset: `0001` }),
        delete: vi.fn().mockResolvedValue(undefined),
      } as any,
      validator: {} as any,
      wakeRegistry: {
        register: registerWake,
        unregisterBySubscriberAndSource,
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      manager.spawn(`chat`, {
        instance_id: `test-1`,
        args: {},
        wake: {
          subscriberUrl: `/other/entity`,
          condition: `runFinished`,
        },
      })
    ).rejects.toThrow()

    // The wake was registered before the failure
    expect(registerWake).toHaveBeenCalled()
    // After failure, the wake should be cleaned up
    expect(unregisterBySubscriberAndSource).toHaveBeenCalledWith(
      `/other/entity`,
      `/chat/test-1`
    )
  })

  it(`appends a delete cleanup event if spawn materialization times out`, async () => {
    const append = vi.fn().mockResolvedValue({ offset: `0001` })
    const deleteStream = vi.fn().mockResolvedValue(undefined)
    const createEntity = vi
      .fn()
      .mockRejectedValue(new Error(`registry create failed`))

    const manager = new ElectricAgentsManager({
      registry: {
        getEntityType: vi.fn().mockResolvedValue({
          name: `chat`,
          description: `test`,
          created_at: `2024-01-01`,
          updated_at: `2024-01-01`,
        }),
        getEntity: vi.fn().mockResolvedValue(null),
        createEntity,
      } as any,
      streamClient: {
        create: vi.fn().mockResolvedValue(undefined),
        delete: deleteStream,
        append,
      } as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn().mockResolvedValue(undefined),
        unregisterBySubscriberAndSource: vi.fn().mockResolvedValue(undefined),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      manager.spawn(`chat`, {
        instance_id: `test-timeout`,
        args: {},
      })
    ).rejects.toThrow(`registry create failed`)

    expect(append).not.toHaveBeenCalled()
    expect(deleteStream).toHaveBeenCalledTimes(2)
  })

  it(`rejects duplicate entity URLs before touching stream creation`, async () => {
    const createStream = vi.fn()
    const manager = new ElectricAgentsManager({
      registry: {
        getEntityType: vi.fn().mockResolvedValue({
          name: `chat`,
          description: `test`,
          created_at: `2024-01-01`,
          updated_at: `2024-01-01`,
        }),
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/stuck`,
          type: `chat`,
          status: `idle`,
          streams: {
            main: `/chat/stuck/main`,
            error: `/chat/stuck/error`,
          },
          subscription_id: `chat-handler`,
          write_token: ``,
          created_at: Date.now(),
          updated_at: Date.now(),
        }),
      } as any,
      streamClient: {
        create: createStream,
      } as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn().mockResolvedValue(undefined),
        unregisterBySubscriberAndSource: vi.fn().mockResolvedValue(undefined),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      manager.spawn(`chat`, {
        instance_id: `stuck`,
        args: {},
      })
    ).rejects.toMatchObject({
      code: `DUPLICATE_URL`,
      status: 409,
    })

    expect(createStream).not.toHaveBeenCalled()
  })
})
