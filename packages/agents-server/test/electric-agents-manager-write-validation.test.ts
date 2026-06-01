import { describe, expect, it, vi } from 'vitest'
import { EntityManager } from '../src/entity-manager'
import { SchemaValidator } from '../src/electric-agents/schema-validator'

const observedItemSchema = {
  type: `object`,
  properties: {
    key: { type: `string` },
    value: { type: `string` },
  },
  required: [`key`, `value`],
}

function createManager() {
  return new EntityManager({
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

function createAttachmentManager({
  entityStatus = `running`,
  readJson = [],
  streamClient = {},
}: {
  entityStatus?: string
  readJson?: Array<unknown>
  streamClient?: Record<string, unknown>
} = {}) {
  return {
    manager: new EntityManager({
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/chat/session-1`,
          status: entityStatus,
          streams: { main: `/chat/session-1` },
        }),
        getEntityType: vi.fn(),
        replaceEntityManifestSource: vi.fn(),
        close: vi.fn(),
      } as any,
      streamClient: {
        create: vi.fn(),
        append: vi.fn(),
        delete: vi.fn(),
        read: vi.fn(),
        readJson: vi.fn().mockResolvedValue(readJson),
        ...streamClient,
      } as any,
      validator: new SchemaValidator(),
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    }),
  }
}

function attachmentManifest(value: Record<string, unknown>) {
  return {
    type: `manifest`,
    key: `attachment:att-1`,
    headers: { operation: `upsert` },
    value: {
      key: `attachment:att-1`,
      kind: `attachment`,
      id: `att-1`,
      streamPath: `/chat/session-1/attachments/att-1`,
      status: `complete`,
      subject: { type: `inbox`, key: `msg-1` },
      role: `input`,
      mimeType: `image/png`,
      byteLength: 4,
      createdAt: `2026-01-01T00:00:00.000Z`,
      ...value,
    },
  }
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

describe(`ElectricAgentsManager attachments`, () => {
  it(`does not delete an existing stream when duplicate attachment creation conflicts`, async () => {
    const create = vi.fn().mockRejectedValue({ status: 409 })
    const remove = vi.fn()
    const { manager } = createAttachmentManager({
      streamClient: { create, delete: remove },
    })

    await expect(
      manager.createAttachment(`/chat/session-1`, {
        id: `att-1`,
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: `image/png`,
        subject: { type: `inbox`, key: `msg-1` },
      })
    ).rejects.toMatchObject({
      status: 409,
      message: `Attachment already exists at id "att-1"`,
    })

    expect(remove).not.toHaveBeenCalled()
  })

  it(`rejects attachment reads whose manifest points at a non-canonical stream`, async () => {
    const read = vi.fn()
    const { manager } = createAttachmentManager({
      readJson: [
        attachmentManifest({
          streamPath: `/chat/other/attachments/att-1`,
        }),
      ],
      streamClient: { read },
    })

    await expect(
      manager.readAttachment(`/chat/session-1`, `att-1`)
    ).rejects.toMatchObject({
      status: 409,
      message: `Attachment stream path does not match its entity and id`,
    })

    expect(read).not.toHaveBeenCalled()
  })

  it(`rejects attachment deletes for entities that are not accepting writes`, async () => {
    const remove = vi.fn()
    const { manager } = createAttachmentManager({
      entityStatus: `stopped`,
      readJson: [attachmentManifest({})],
      streamClient: { delete: remove },
    })

    await expect(
      manager.deleteAttachment(`/chat/session-1`, `att-1`)
    ).rejects.toMatchObject({
      status: 409,
      message: `Entity is not accepting writes`,
    })

    expect(remove).not.toHaveBeenCalled()
  })
})

describe(`ElectricAgentsManager event source subscriptions`, () => {
  it(`persists the manifest before registering wake side effects`, async () => {
    const calls: Array<string> = []
    const manager = createManifestManager(calls)

    await manager.upsertEventSourceSubscription(`/coder/session-1`, {
      subscription: {
        id: `watch-pr-123`,
        entityUrl: `/coder/session-1`,
        sourceKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        filterApplied: false,
        contractRevision: 1,
        sourceUrl: `/_webhooks/github-repo/prs/123`,
        sourceType: `webhook`,
        manifestKey: `event-source:watch-pr-123`,
        lifetime: { kind: `until_entity_stopped` },
        createdBy: `tool`,
        createdAt: `2026-05-23T00:00:00.000Z`,
      },
      manifest: {
        key: `event-source:watch-pr-123`,
        kind: `source`,
        sourceType: `webhook`,
        sourceRef: `github-repo/prs/123`,
        config: {
          endpointKey: `github-repo`,
          streamUrl: `/_webhooks/github-repo/prs/123`,
        },
        wake: {
          on: `change`,
          collections: [`webhook_event`],
          ops: [`insert`],
        },
      },
    })

    expect(calls).toEqual([`append`, `unregister`, `register`])
  })

  it(`persists subscription deletion before unregistering wake side effects`, async () => {
    const calls: Array<string> = []
    const manager = createManifestManager(calls)

    await manager.deleteEventSourceSubscription(`/coder/session-1`, {
      id: `watch-pr-123`,
    })

    expect(calls).toEqual([`append`, `unregister`])
  })
})

function createManifestManager(calls: Array<string>) {
  return new EntityManager({
    registry: {
      tenantId: `tenant-a`,
      getEntity: vi.fn().mockResolvedValue({
        url: `/coder/session-1`,
        streams: { main: `/_entities/coder/session-1` },
      }),
      getEntityType: vi.fn(),
      replaceEntityManifestSource: vi.fn(),
      close: vi.fn(),
    } as any,
    streamClient: {
      append: vi.fn(async () => {
        calls.push(`append`)
      }),
    } as any,
    validator: new SchemaValidator(),
    wakeRegistry: {
      setTimeoutCallback: vi.fn(),
      setDebounceCallback: vi.fn(),
      unregisterByManifestKey: vi.fn(async () => {
        calls.push(`unregister`)
      }),
      register: vi.fn(async () => {
        calls.push(`register`)
      }),
    } as any,
  })
}
