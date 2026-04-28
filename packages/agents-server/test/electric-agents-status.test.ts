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

describe(`ElectricAgentsManager.forkSubtree`, () => {
  function makeEntity(url: string, parent?: string) {
    const type = url.split(`/`)[1]!
    return {
      url,
      type,
      status: `idle`,
      streams: {
        main: `${url}/main`,
        error: `${url}/error`,
      },
      subscription_id: `${type}-handler`,
      write_token: `${type}-token`,
      tags: {},
      spawn_args: {},
      ...(parent ? { parent } : {}),
      created_at: Date.now(),
      updated_at: Date.now(),
    } as const
  }

  it(`forks durable streams before registering remapped entity rows`, async () => {
    const root = makeEntity(`/manager/root`)
    const child = makeEntity(`/worker/child`, root.url)
    const entitiesByUrl = new Map<string, any>([
      [root.url, root],
      [child.url, child],
    ])
    const calls: Array<string> = []
    const appendedEvents: Array<Record<string, unknown>> = []

    const registry = {
      getEntity: vi.fn(async (url: string) => entitiesByUrl.get(url) ?? null),
      listEntities: vi.fn(async ({ parent }: { parent?: string }) => ({
        entities: parent === root.url ? [child] : [],
        total: parent === root.url ? 1 : 0,
      })),
      createEntity: vi.fn(async (entity: any) => {
        calls.push(`entity:${entity.url}`)
        entitiesByUrl.set(entity.url, entity)
        return 123
      }),
      deleteEntity: vi.fn(),
      replaceEntityManifestSource: vi.fn(),
    }

    const streamClient = {
      readJson: vi.fn(async (path: string) => {
        if (path !== root.streams.main) return []
        return [
          {
            type: `manifest`,
            key: `child:worker:child`,
            headers: { operation: `insert` },
            value: {
              key: `child:worker:child`,
              kind: `child`,
              id: `child`,
              entity_type: `worker`,
              entity_url: child.url,
              observed: true,
            },
          },
          {
            type: `manifest`,
            key: `shared-state:board`,
            headers: { operation: `insert` },
            value: {
              key: `shared-state:board`,
              kind: `shared-state`,
              id: `board`,
              mode: `create`,
              collections: {
                notes: { type: `shared:note`, primaryKey: `id` },
              },
            },
          },
        ]
      }),
      exists: vi.fn().mockResolvedValue(false),
      fork: vi.fn(async (path: string, sourcePath: string) => {
        calls.push(`fork:${path}<-${sourcePath}`)
      }),
      append: vi.fn(async (_path: string, data: Uint8Array | string) => {
        const text =
          typeof data === `string` ? data : new TextDecoder().decode(data)
        appendedEvents.push(JSON.parse(text))
        return { offset: `1` }
      }),
      delete: vi.fn(),
    }

    const manager = new ElectricAgentsManager({
      registry: registry as any,
      streamClient: streamClient as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn(),
        unregisterBySubscriber: vi.fn(),
        unregisterBySource: vi.fn(),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    const result = await manager.forkSubtree(root.url, {
      rootInstanceId: `root-copy`,
      waitTimeoutMs: 0,
    })

    expect(result.root.url).toBe(`/manager/root-copy`)
    expect(result.entities).toHaveLength(2)
    const forkedChild = result.entities.find(
      (entity) => entity.type === `worker`
    )
    expect(forkedChild?.parent).toBe(`/manager/root-copy`)

    const firstEntityWrite = calls.findIndex((call) =>
      call.startsWith(`entity:`)
    )
    const lastFork = calls.reduce(
      (index, call, current) => (call.startsWith(`fork:`) ? current : index),
      -1
    )
    expect(firstEntityWrite).toBeGreaterThan(lastFork)
    expect(streamClient.fork).toHaveBeenCalledWith(
      expect.stringMatching(/^\/_electric\/shared-state\/board-fork-/),
      `/_electric/shared-state/board`
    )

    const manifestInserts = appendedEvents.filter(
      (event) =>
        event.type === `manifest` &&
        (event.headers as Record<string, unknown>).operation === `insert`
    )
    expect(manifestInserts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            kind: `child`,
            entity_url: forkedChild?.url,
          }),
        }),
        expect.objectContaining({
          value: expect.objectContaining({
            kind: `shared-state`,
            id: expect.stringMatching(/^board-fork-/),
          }),
        }),
      ])
    )
  })

  it(`times out instead of forking while the subtree is active`, async () => {
    const root = {
      ...makeEntity(`/manager/busy`),
      status: `running`,
    }
    const manager = new ElectricAgentsManager({
      registry: {
        getEntity: vi.fn().mockResolvedValue(root),
        listEntities: vi.fn().mockResolvedValue({ entities: [], total: 0 }),
      } as any,
      streamClient: {
        fork: vi.fn(),
      } as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn(),
        unregisterBySubscriber: vi.fn(),
        unregisterBySource: vi.fn(),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      manager.forkSubtree(root.url, {
        waitTimeoutMs: 1,
        waitPollMs: 1,
      })
    ).rejects.toMatchObject({
      code: `FORK_WAIT_TIMEOUT`,
      status: 409,
    })
  })

  it(`rejects sends to any subtree entity while fork snapshotting is in progress`, async () => {
    const root = makeEntity(`/manager/root`)
    const child = makeEntity(`/worker/child`, root.url)
    const entitiesByUrl = new Map<string, any>([
      [root.url, root],
      [child.url, child],
    ])
    let releaseRootRead!: () => void
    const rootReadStarted = new Promise<void>((resolve) => {
      releaseRootRead = resolve
    })

    const streamClient = {
      readJson: vi.fn(async (path: string) => {
        if (path === root.streams.main) {
          await new Promise<void>((resolve) => {
            rootReadStarted.then(resolve)
          })
        }
        return []
      }),
      exists: vi.fn().mockResolvedValue(false),
      fork: vi.fn().mockResolvedValue(undefined),
      append: vi.fn().mockResolvedValue({ offset: `1` }),
      delete: vi.fn(),
    }

    const manager = new ElectricAgentsManager({
      registry: {
        getEntity: vi.fn(async (url: string) => entitiesByUrl.get(url) ?? null),
        listEntities: vi.fn(async ({ parent }: { parent?: string }) => ({
          entities: parent === root.url ? [child] : [],
          total: parent === root.url ? 1 : 0,
        })),
        createEntity: vi.fn(async (entity: any) => {
          entitiesByUrl.set(entity.url, entity)
          return 123
        }),
        deleteEntity: vi.fn(),
        replaceEntityManifestSource: vi.fn(),
      } as any,
      streamClient: streamClient as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn(),
        unregisterBySubscriber: vi.fn(),
        unregisterBySource: vi.fn(),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    const forkPromise = manager.forkSubtree(root.url, {
      rootInstanceId: `root-copy`,
      waitTimeoutMs: 100,
    })

    await vi.waitFor(() => {
      expect(streamClient.readJson).toHaveBeenCalledWith(root.streams.main)
    })

    await expect(
      manager.send(child.url, {
        from: `user`,
        payload: `new work`,
      })
    ).rejects.toMatchObject({
      code: `FORK_IN_PROGRESS`,
      status: 409,
    })
    expect(streamClient.append).not.toHaveBeenCalledWith(
      child.streams.main,
      expect.anything()
    )

    releaseRootRead()
    await forkPromise
  })

  it(`releases fork locks when stream forking fails`, async () => {
    const root = makeEntity(`/manager/root`)
    const entitiesByUrl = new Map<string, any>([[root.url, root]])

    const streamClient = {
      readJson: vi.fn().mockResolvedValue([]),
      exists: vi.fn().mockResolvedValue(false),
      fork: vi.fn().mockRejectedValue(new Error(`fork failed`)),
      append: vi.fn().mockResolvedValue({ offset: `1` }),
      delete: vi.fn(),
    }

    const manager = new ElectricAgentsManager({
      registry: {
        getEntity: vi.fn(async (url: string) => entitiesByUrl.get(url) ?? null),
        listEntities: vi.fn().mockResolvedValue({ entities: [], total: 0 }),
        createEntity: vi.fn(),
        deleteEntity: vi.fn(),
        replaceEntityManifestSource: vi.fn(),
      } as any,
      streamClient: streamClient as any,
      validator: {} as any,
      wakeRegistry: {
        register: vi.fn(),
        unregisterBySubscriber: vi.fn(),
        unregisterBySource: vi.fn(),
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      manager.forkSubtree(root.url, {
        rootInstanceId: `root-copy`,
        waitTimeoutMs: 0,
      })
    ).rejects.toThrow(`fork failed`)

    await expect(
      manager.send(root.url, {
        from: `user`,
        payload: `after failure`,
      })
    ).resolves.toBeUndefined()
    expect(streamClient.append).toHaveBeenCalledWith(
      root.streams.main,
      expect.any(Uint8Array)
    )
  })
})
