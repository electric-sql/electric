import { describe, expect, it, vi } from 'vitest'
import { ElectricAgentsManager } from '../src/electric-agents-manager'
import { SchemaValidator } from '../src/electric-agents-schema-validator'

const observedItemSchema = {
  type: `object`,
  properties: {
    key: { type: `string` },
    value: { type: `string` },
  },
  required: [`key`, `value`],
}

function createManager() {
  return new ElectricAgentsManager({
    registry: {
      getEntityType: vi.fn().mockResolvedValue({
        name: `observed-child-e1`,
        description: `test`,
        created_at: `2026-01-01T00:00:00.000Z`,
        updated_at: `2026-01-01T00:00:00.000Z`,
        state_schemas: {
          observed_item: observedItemSchema,
        },
      }),
      close: vi.fn(),
    } as any,
    streamClient: {} as any,
    validator: new SchemaValidator(),
    wakeRegistry: {
      setTimeoutCallback: vi.fn(),
      setDebounceCallback: vi.fn(),
    } as any,
  })
}

describe(`ElectricAgentsManager.validateWriteEvent`, () => {
  it(`validates delete events against old_value instead of value`, async () => {
    const manager = createManager()

    const validationError = await manager.validateWriteEvent(
      {
        type: `observed-child-e1`,
        state_schemas: {
          observed_item: observedItemSchema,
        },
      } as any,
      {
        type: `observed_item`,
        headers: { operation: `delete` },
        old_value: {
          key: `item-1`,
          value: `alpha`,
        },
      }
    )

    expect(validationError).toBeNull()
  })

  it(`supports overriding entity write-token validation`, () => {
    const manager = createManager()
    const entity = { write_token: `entity-token` } as any

    expect((manager as any).isValidWriteToken(entity, `entity-token`)).toBe(
      true
    )
    expect((manager as any).isValidWriteToken(entity, `claim-token`)).toBe(
      false
    )

    manager.setWriteTokenValidator((_currentEntity, token) => {
      return token === `claim-token`
    })

    expect((manager as any).isValidWriteToken(entity, `entity-token`)).toBe(
      false
    )
    expect((manager as any).isValidWriteToken(entity, `claim-token`)).toBe(true)
  })
})

describe(`ElectricAgentsManager.send append callback`, () => {
  it(`notifies after successful send append`, async () => {
    const entity = {
      url: `/horton/h1`,
      streams: { main: `/horton/h1/main` },
      inbox_schemas: undefined,
    }
    const registry = {
      getEntity: vi.fn().mockResolvedValue(entity),
      close: vi.fn(),
    }
    const streamClient = {
      append: vi.fn().mockResolvedValue(undefined),
    }
    const manager = new ElectricAgentsManager({
      registry: registry as any,
      streamClient: streamClient as any,
      validator: new SchemaValidator(),
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })
    const callback = vi.fn()
    manager.setEntityAppendCallback(callback)

    await manager.send(`/horton/h1`, {
      from: `test`,
      payload: { hello: `world` },
    })

    expect(streamClient.append).toHaveBeenCalledOnce()
    expect(callback).toHaveBeenCalledOnce()
    expect(callback.mock.calls[0]![0]).toBe(entity)
    expect(callback.mock.calls[0]![1]).toMatchObject({
      type: `message_received`,
      value: { payload: { hello: `world` } },
    })
  })

  it(`does not notify when send append fails`, async () => {
    const entity = {
      url: `/horton/h1`,
      streams: { main: `/horton/h1/main` },
    }
    const manager = new ElectricAgentsManager({
      registry: {
        getEntity: vi.fn().mockResolvedValue(entity),
        close: vi.fn(),
      } as any,
      streamClient: {
        append: vi.fn().mockRejectedValue(new Error(`boom`)),
      } as any,
      validator: new SchemaValidator(),
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })
    const callback = vi.fn()
    manager.setEntityAppendCallback(callback)

    await expect(
      manager.send(`/horton/h1`, { from: `test`, payload: { hello: `world` } })
    ).rejects.toThrow(`boom`)

    expect(callback).not.toHaveBeenCalled()
  })
})
