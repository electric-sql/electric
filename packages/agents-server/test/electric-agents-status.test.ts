import { describe, expect, it, vi } from 'vitest'
import { EntityManager } from '../src/entity-manager'
import {
  assertEntityStatus,
  rejectsNormalWrites,
} from '../src/electric-agents-types'

describe(`assertEntityStatus`, () => {
  it(`returns valid statuses unchanged`, () => {
    expect(assertEntityStatus(`spawning`)).toBe(`spawning`)
    expect(assertEntityStatus(`running`)).toBe(`running`)
    expect(assertEntityStatus(`idle`)).toBe(`idle`)
    expect(assertEntityStatus(`paused`)).toBe(`paused`)
    expect(assertEntityStatus(`stopping`)).toBe(`stopping`)
    expect(assertEntityStatus(`stopped`)).toBe(`stopped`)
    expect(assertEntityStatus(`killed`)).toBe(`killed`)
  })

  it(`throws on invalid status strings`, () => {
    expect(() => assertEntityStatus(`active`)).toThrow(`Invalid entity status`)
    expect(() => assertEntityStatus(``)).toThrow(`Invalid entity status`)
  })
})

describe(`signal-aware status write guards`, () => {
  it(`allows paused writes but rejects stopping, stopped, or killed`, () => {
    expect(rejectsNormalWrites(`spawning`)).toBe(false)
    expect(rejectsNormalWrites(`running`)).toBe(false)
    expect(rejectsNormalWrites(`idle`)).toBe(false)
    expect(rejectsNormalWrites(`paused`)).toBe(false)
    expect(rejectsNormalWrites(`stopping`)).toBe(true)
    expect(rejectsNormalWrites(`stopped`)).toBe(true)
    expect(rejectsNormalWrites(`killed`)).toBe(true)
  })
})

describe(`ElectricAgentsManager.signal semantics`, () => {
  function decodeAppendBody(body: unknown): string {
    return body instanceof Uint8Array
      ? new TextDecoder().decode(body)
      : String(body)
  }

  function createSignalManager(status: `running` | `idle` | `paused`) {
    const entity = {
      url: `/chat/demo`,
      type: `chat`,
      status,
      streams: {
        main: `/chat/demo/main`,
      },
      subscription_id: `chat-handler`,
      write_token: `token`,
      tags: {},
      spawn_args: {},
      created_at: Date.now(),
      updated_at: Date.now(),
    }
    const registry = {
      tenantId: `default`,
      getEntity: vi.fn().mockResolvedValue(entity),
      touchEntityWithTxid: vi.fn().mockResolvedValue(101),
      updateStatusWithTxid: vi.fn().mockResolvedValue(202),
      updateStatus: vi.fn().mockResolvedValue(undefined),
    }
    const append = vi.fn().mockResolvedValue({ offset: `1` })
    const unregisterBySubscriber = vi.fn().mockResolvedValue(undefined)
    const unregisterBySource = vi.fn().mockResolvedValue(undefined)
    const manager = new EntityManager({
      registry: registry as any,
      streamClient: {
        append,
      } as any,
      validator: {} as any,
      wakeRegistry: {
        evaluate: vi.fn(() => []),
        unregisterBySubscriber,
        unregisterBySource,
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })
    return {
      manager,
      registry,
      append,
      unregisterBySubscriber,
      unregisterBySource,
    }
  }

  it(`keeps SIGINT as a run-local abort without changing entity status`, async () => {
    const { manager, registry } = createSignalManager(`running`)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGINT` })
    ).resolves.toMatchObject({
      previous_state: `running`,
      new_state: `running`,
      txid: 101,
    })

    expect(registry.touchEntityWithTxid).toHaveBeenCalledWith(`/chat/demo`)
    expect(registry.updateStatusWithTxid).not.toHaveBeenCalled()
  })

  it(`moves SIGSTOP to paused so existing pending work is skipped`, async () => {
    const { manager, registry } = createSignalManager(`running`)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGSTOP` })
    ).resolves.toMatchObject({
      previous_state: `running`,
      new_state: `paused`,
      txid: 202,
    })

    expect(registry.updateStatusWithTxid).toHaveBeenCalledWith(
      `/chat/demo`,
      `paused`
    )
  })

  it(`moves running SIGTERM to stopping until runtime cleanup marks stopped`, async () => {
    const { manager, registry } = createSignalManager(`running`)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGTERM` })
    ).resolves.toMatchObject({
      previous_state: `running`,
      new_state: `stopping`,
      txid: 202,
    })

    expect(registry.updateStatusWithTxid).toHaveBeenCalledWith(
      `/chat/demo`,
      `stopping`
    )
  })

  it(`marks non-resume paused signals as ignored so they do not wait for a runner`, async () => {
    const { manager, registry, append } = createSignalManager(`paused`)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGINT` })
    ).resolves.toMatchObject({
      previous_state: `paused`,
      new_state: `paused`,
      txid: 101,
    })

    expect(registry.touchEntityWithTxid).toHaveBeenCalledWith(`/chat/demo`)
    expect(registry.updateStatusWithTxid).not.toHaveBeenCalled()
    const body = decodeAppendBody(append.mock.calls[0]?.[1])
    expect(body).toContain(`"status":"handled"`)
    expect(body).toContain(`"outcome":"ignored"`)
  })

  it(`keeps paused SIGCONT unhandled after moving to idle so the runtime can resume queued work`, async () => {
    const { manager, registry, append } = createSignalManager(`paused`)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGCONT` })
    ).resolves.toMatchObject({
      previous_state: `paused`,
      new_state: `idle`,
      txid: 202,
    })

    expect(registry.updateStatusWithTxid).toHaveBeenCalledWith(
      `/chat/demo`,
      `idle`
    )
    expect(decodeAppendBody(append.mock.calls[0]?.[1])).toContain(
      `"status":"unhandled"`
    )
  })

  it(`rejects signal updates when the guarded status write loses a terminal race`, async () => {
    const { manager, registry, append } = createSignalManager(`idle`)
    registry.updateStatusWithTxid.mockResolvedValueOnce(null)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGKILL` })
    ).rejects.toMatchObject({
      code: `INVALID_SIGNAL`,
      status: 409,
    })

    expect(append).not.toHaveBeenCalled()
  })

  it(`rejects no-op signal updates when touch loses a terminal race`, async () => {
    const { manager, registry, append } = createSignalManager(`idle`)
    registry.touchEntityWithTxid.mockResolvedValueOnce(null)

    await expect(
      manager.signal(`/chat/demo`, { signal: `SIGINT` })
    ).rejects.toMatchObject({
      code: `INVALID_SIGNAL`,
      status: 409,
    })

    expect(append).not.toHaveBeenCalled()
  })

  it(`wakes a paused entity by moving it to idle on a new message`, async () => {
    const { manager, registry } = createSignalManager(`paused`)

    await manager.send(`/chat/demo`, {
      from: `user`,
      payload: { text: `wake up` },
    })

    expect(registry.updateStatusWithTxid).not.toHaveBeenCalled()
    expect(registry.updateStatus).toHaveBeenCalledWith(`/chat/demo`, `idle`)
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

    const manager = new EntityManager({
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
      `/chat/test-1`,
      `default`
    )
  })

  it(`appends a delete cleanup event if spawn materialization times out`, async () => {
    const append = vi.fn().mockResolvedValue({ offset: `0001` })
    const deleteStream = vi.fn().mockResolvedValue(undefined)
    const createEntity = vi
      .fn()
      .mockRejectedValue(new Error(`registry create failed`))

    const manager = new EntityManager({
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
    expect(deleteStream).toHaveBeenCalledTimes(1)
  })

  it(`rejects duplicate entity URLs before touching stream creation`, async () => {
    const createStream = vi.fn()
    const manager = new EntityManager({
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
      },
      subscription_id: `${type}-handler`,
      write_token: `${type}-token`,
      tags: {},
      spawn_args: {},
      ...(parent ? { parent } : {}),
      created_at: Date.now(),
      updated_at: Date.now(),
      created_by: `/principal/user%3Aoriginal-owner`,
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
      replaceSharedStateLink: vi.fn(),
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
          {
            type: `manifest`,
            key: `document:notes`,
            headers: { operation: `insert` },
            value: {
              key: `document:notes`,
              kind: `document`,
              id: `notes`,
              provider: `y-durable-streams`,
              docId: `agents/manager/root/documents/notes`,
              docPath: `agents/manager/root/documents/notes`,
              streamPath: `/v1/yjs/default/docs/agents/manager/root/documents/notes`,
              transportMimeType: `application/vnd.electric-agents.markdown-yjs`,
              contentMimeType: `text/markdown`,
              yTextName: `markdown`,
              title: `Notes`,
              createdAt: `2026-01-01T00:00:00.000Z`,
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

    const manager = new EntityManager({
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
      createdBy: `/principal/user%3Aforker`,
    })

    expect(result.root.url).toBe(`/manager/root-copy`)
    expect(result.root.created_by).toBe(`/principal/user%3Aforker`)
    expect(result.entities).toHaveLength(2)
    const forkedChild = result.entities.find(
      (entity) => entity.type === `worker`
    )
    expect(forkedChild?.parent).toBe(`/manager/root-copy`)
    expect(forkedChild?.created_by).toBe(`/principal/user%3Aforker`)

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
    expect(streamClient.fork).toHaveBeenCalledWith(
      `/yjs/default/docs/agents/manager/root-copy/documents/notes/.updates`,
      `/yjs/default/docs/agents/manager/root/documents/notes/.updates`
    )

    const manifestWrites = appendedEvents.filter(
      (event) =>
        event.type === `manifest` &&
        [`insert`, `update`].includes(
          String((event.headers as Record<string, unknown>).operation)
        )
    )
    expect(manifestWrites).toEqual(
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
        expect.objectContaining({
          value: expect.objectContaining({
            kind: `document`,
            id: `notes`,
            docId: `agents/manager/root-copy/documents/notes`,
            docPath: `agents/manager/root-copy/documents/notes`,
            streamPath: `/v1/yjs/default/docs/agents/manager/root-copy/documents/notes`,
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
    const manager = new EntityManager({
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

    const manager = new EntityManager({
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
        replaceSharedStateLink: vi.fn(),
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

    const manager = new EntityManager({
      registry: {
        getEntity: vi.fn(async (url: string) => entitiesByUrl.get(url) ?? null),
        listEntities: vi.fn().mockResolvedValue({ entities: [], total: 0 }),
        createEntity: vi.fn(),
        deleteEntity: vi.fn(),
        replaceEntityManifestSource: vi.fn(),
        replaceSharedStateLink: vi.fn(),
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
