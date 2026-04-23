import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsManager } from '../src/electric-agents-manager'

function createManager() {
  const registry = {
    getEntityType: vi.fn(),
    createEntityType: vi.fn(),
    updateEntityTypeInPlace: vi.fn(),
    deleteEntityType: vi.fn(),
  }
  const streamClient = {
    append: vi.fn(),
    exists: vi.fn(),
    create: vi.fn(),
  }
  const validator = {
    validateSchemaSubset: vi.fn().mockReturnValue(null),
  }
  const wakeRegistry = {
    setTimeoutCallback: vi.fn(),
    setDebounceCallback: vi.fn(),
  }

  const manager = new ElectricAgentsManager({
    registry: registry as any,
    streamClient: streamClient as any,
    validator: validator as any,
    wakeRegistry: wakeRegistry as any,
  })

  return {
    manager,
    registry,
    streamClient,
    validator,
  }
}

describe(`ElectricAgentsManager entity type persistence`, () => {
  it(`registerEntityType writes directly to the registry`, async () => {
    const { manager, registry, streamClient } = createManager()

    registry.getEntityType.mockResolvedValueOnce(null).mockResolvedValueOnce({
      name: `chat`,
      description: `chat entity`,
      creation_schema: { type: `object` },
      inbox_schemas: undefined,
      state_schemas: { message: { type: `object` } },
      serve_endpoint: `http://runtime.test/webhook`,
      revision: 1,
      created_at: `2026-01-01T00:00:00.000Z`,
      updated_at: `2026-01-01T00:00:00.000Z`,
    })

    const result = await manager.registerEntityType({
      name: `chat`,
      description: `chat entity`,
      creation_schema: { type: `object` },
      state_schemas: { message: { type: `object` } },
      serve_endpoint: `http://runtime.test/webhook`,
    })

    expect(registry.createEntityType).toHaveBeenCalledTimes(1)
    expect(streamClient.append).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      name: `chat`,
      revision: 1,
      serve_endpoint: `http://runtime.test/webhook`,
    })
  })

  it(`amendSchemas updates the registry in place without the materializer`, async () => {
    const { manager, registry, streamClient } = createManager()

    registry.getEntityType
      .mockResolvedValueOnce({
        name: `chat`,
        description: `chat entity`,
        creation_schema: undefined,
        inbox_schemas: { greet: { type: `object` } },
        state_schemas: { message: { type: `object` } },
        serve_endpoint: undefined,
        revision: 2,
        created_at: `2026-01-01T00:00:00.000Z`,
        updated_at: `2026-01-02T00:00:00.000Z`,
      })
      .mockResolvedValueOnce({
        name: `chat`,
        description: `chat entity`,
        creation_schema: undefined,
        inbox_schemas: {
          greet: { type: `object` },
          reply: { type: `object` },
        },
        state_schemas: {
          message: { type: `object` },
          transcript: { type: `array` },
        },
        serve_endpoint: undefined,
        revision: 3,
        created_at: `2026-01-01T00:00:00.000Z`,
        updated_at: `2026-01-03T00:00:00.000Z`,
      })

    const result = await manager.amendSchemas(`chat`, {
      inbox_schemas: { reply: { type: `object` } },
      state_schemas: { transcript: { type: `array` } },
    })

    expect(registry.updateEntityTypeInPlace).toHaveBeenCalledTimes(1)
    expect(streamClient.append).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      name: `chat`,
      revision: 3,
      inbox_schemas: expect.objectContaining({
        greet: { type: `object` },
        reply: { type: `object` },
      }),
      state_schemas: expect.objectContaining({
        message: { type: `object` },
        transcript: { type: `array` },
      }),
    })
  })

  it(`deleteEntityType deletes directly from the registry`, async () => {
    const { manager, registry, streamClient } = createManager()

    registry.getEntityType.mockResolvedValue({
      name: `chat`,
      description: `chat entity`,
      creation_schema: undefined,
      inbox_schemas: undefined,
      state_schemas: undefined,
      serve_endpoint: undefined,
      revision: 1,
      created_at: `2026-01-01T00:00:00.000Z`,
      updated_at: `2026-01-01T00:00:00.000Z`,
    })

    await manager.deleteEntityType(`chat`)

    expect(registry.deleteEntityType).toHaveBeenCalledWith(`chat`)
    expect(streamClient.append).not.toHaveBeenCalled()
  })
})
