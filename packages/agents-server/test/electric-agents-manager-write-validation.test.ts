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
        replaceSharedStateLink: vi.fn(),
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

function decodeAppend(call: unknown[]): Record<string, any> {
  const body = call[1]
  const bytes =
    body instanceof Uint8Array ? body : new TextEncoder().encode(String(body))
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, any>
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

describe(`ElectricAgentsManager realtime sessions`, () => {
  it(`creates durable IO streams and records a replayable session manifest`, async () => {
    const create = vi.fn()
    const append = vi.fn()
    const { manager } = createAttachmentManager({
      streamClient: { create, append },
    })

    const result = await manager.createRealtimeSession(`/chat/session-1`, {
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime-2`,
      inputAudio: { codec: `pcm16`, sampleRate: 16_000, channels: 1 },
      outputAudio: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
      meta: { source: `test` },
    })

    expect(result.streams).toEqual({
      audio_in: `/chat/session-1/realtime/rt-1/audio/in`,
      audio_out: `/chat/session-1/realtime/rt-1/audio/out`,
      control_in: `/chat/session-1/realtime/rt-1/control/in`,
      control_out: `/chat/session-1/realtime/rt-1/control/out`,
    })
    expect(create).toHaveBeenCalledTimes(4)
    expect(create.mock.calls).toEqual([
      [
        `/chat/session-1/realtime/rt-1/audio/in`,
        { contentType: `audio/pcm; rate=16000; channels=1` },
      ],
      [
        `/chat/session-1/realtime/rt-1/audio/out`,
        { contentType: `audio/pcm; rate=24000; channels=1` },
      ],
      [
        `/chat/session-1/realtime/rt-1/control/in`,
        { contentType: `application/json` },
      ],
      [
        `/chat/session-1/realtime/rt-1/control/out`,
        { contentType: `application/json` },
      ],
    ])

    expect(append).toHaveBeenCalledTimes(3)
    const manifestEvent = decodeAppend(append.mock.calls[0]!)
    const sessionEvent = decodeAppend(append.mock.calls[1]!)
    const wakeEvent = decodeAppend(append.mock.calls[2]!)

    expect(manifestEvent).toMatchObject({
      type: `manifest`,
      key: `realtime-session:rt-1`,
      headers: { operation: `upsert` },
      value: {
        kind: `realtime-session`,
        id: `rt-1`,
        provider: `openai`,
        model: `gpt-realtime-2`,
        status: `requested`,
        streams: result.streams,
        retention: `forever`,
        meta: { source: `test` },
      },
    })
    expect(sessionEvent).toMatchObject({
      type: `realtime_session`,
      key: `realtime-session:rt-1`,
      value: {
        session_id: `rt-1`,
        provider: `openai`,
        model: `gpt-realtime-2`,
        status: `requested`,
        streams: result.streams,
      },
    })
    expect(wakeEvent).toMatchObject({
      type: `wake`,
      key: `wake-realtime-session-rt-1`,
      value: {
        source: `/chat/session-1`,
        timeout: false,
        changes: [
          {
            collection: `realtimeSessions`,
            kind: `insert`,
            key: `realtime-session:rt-1`,
            from: `/_electric/server`,
            payload: {
              type: `realtime_session.started`,
              sessionId: `rt-1`,
              streams: result.streams,
            },
            message_type: `realtime_session.started`,
          },
        ],
      },
    })
  })

  it(`rejects non-OpenAI realtime providers in V1`, async () => {
    const { manager } = createAttachmentManager()

    await expect(
      manager.createRealtimeSession(`/chat/session-1`, {
        id: `rt-1`,
        provider: `other`,
        model: `other-realtime`,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: `Realtime provider "other" is not supported; expected "openai"`,
    })
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

describe(`ElectricAgentsManager composer input validation`, () => {
  it(`accepts composer_input without an entity-declared inbox schema`, async () => {
    const manager = new EntityManager({
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/coder/session-1`,
          type: `coder`,
          status: `idle`,
          inbox_schemas: {
            note: {
              type: `object`,
              properties: { body: { type: `string` } },
              required: [`body`],
            },
          },
        }),
        getEntityType: vi.fn().mockResolvedValue({
          inbox_schemas: {
            note: {
              type: `object`,
              properties: { body: { type: `string` } },
              required: [`body`],
            },
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

    await expect(
      (manager as any).validateSendRequest(`/coder/session-1`, {
        from: `/principal/user-1`,
        type: `composer_input`,
        payload: {
          source: `/quickstart`,
          nodes: [
            {
              kind: `slash_command`,
              start: 0,
              end: 11,
              raw: `/quickstart`,
              name: `quickstart`,
            },
          ],
        },
      })
    ).resolves.toMatchObject({ url: `/coder/session-1` })
  })

  it(`rejects invalid composer_input payloads`, async () => {
    const manager = new EntityManager({
      registry: {
        getEntity: vi.fn().mockResolvedValue({
          url: `/coder/session-1`,
          type: `coder`,
          status: `idle`,
        }),
        getEntityType: vi.fn(),
        close: vi.fn(),
      } as any,
      streamClient: {} as any,
      validator: new SchemaValidator(),
      wakeRegistry: {
        setTimeoutCallback: vi.fn(),
        setDebounceCallback: vi.fn(),
      } as any,
    })

    await expect(
      (manager as any).validateSendRequest(`/coder/session-1`, {
        from: `/principal/user-1`,
        type: `composer_input`,
        payload: {
          source: `/quickstart`,
          nodes: [
            {
              kind: `slash_command`,
              start: 0,
              end: 11,
              raw: `/quick`,
              name: `QuickStart`,
            },
          ],
        },
      })
    ).rejects.toMatchObject({
      code: `SCHEMA_VALIDATION_FAILED`,
      status: 422,
      details: expect.arrayContaining([
        {
          path: `/nodes/0/raw`,
          message: `must equal source.slice(start, end)`,
        },
        {
          path: `/nodes/0/name`,
          message: `must be a lowercase kebab-case command name`,
        },
      ]),
    })
  })
})

describe(`ElectricAgentsManager webhook source subscriptions`, () => {
  it(`persists the manifest before registering wake side effects`, async () => {
    const calls: Array<string> = []
    const manager = createManifestManager(calls)

    await manager.upsertWebhookSourceSubscription(`/coder/session-1`, {
      subscription: {
        id: `watch-pr-123`,
        entityUrl: `/coder/session-1`,
        webhookKey: `github-repo`,
        bucketKey: `pull_request`,
        params: { number: 123 },
        filterApplied: false,
        contractRevision: 1,
        sourceUrl: `/_webhooks/github-repo/prs/123`,
        sourceType: `webhook`,
        manifestKey: `webhook-source:watch-pr-123`,
        lifetime: { kind: `until_entity_stopped` },
        createdBy: `tool`,
        createdAt: `2026-05-23T00:00:00.000Z`,
      },
      manifest: {
        key: `webhook-source:watch-pr-123`,
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

    await manager.deleteWebhookSourceSubscription(`/coder/session-1`, {
      id: `watch-pr-123`,
    })

    expect(calls).toEqual([`append`, `unregister`])
  })
})

function decodeAppendEvent(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
}

describe(`ElectricAgentsManager.writeCollection`, () => {
  const principal = {
    url: `/principal/user%3Aalice`,
    kind: `user`,
    id: `alice`,
  }

  it(`stamps the principal header and appends a generic collection insert`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:comments': {} },
      externally_writable_collections: {
        comments: { type: `state:comments` },
      },
    })

    const result = await manager.writeCollection(
      `/chat/session-1`,
      `comments`,
      {
        operation: `insert`,
        key: `c1`,
        value: { body: `hi` },
        principal,
      }
    )

    expect(result).toEqual({ key: `c1` })
    const event = decodeAppendEvent(append.mock.calls[0]?.[1])
    expect(event).toMatchObject({
      type: `state:comments`,
      key: `c1`,
      headers: { operation: `insert`, principal },
      value: { body: `hi` },
    })
    expect(
      (event.value as Record<string, unknown>).from_principal
    ).toBeUndefined()
  })

  it(`rejects writes to a collection that is not writable`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:notes': {} },
      externally_writable_collections: {},
    })

    await expect(
      manager.writeCollection(`/chat/session-1`, `notes`, {
        operation: `insert`,
        value: { note: `x` },
        principal,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(append).not.toHaveBeenCalled()
  })

  it(`rejects values that fail the collection schema with 422`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: {
        'state:comments': {
          type: `object`,
          properties: { body: { type: `string` } },
          required: [`body`],
          additionalProperties: false,
        },
      },
      externally_writable_collections: {
        comments: { type: `state:comments` },
      },
    })

    await expect(
      manager.writeCollection(`/chat/session-1`, `comments`, {
        operation: `insert`,
        key: `c1`,
        value: { body: 42 },
        principal,
      })
    ).rejects.toMatchObject({ status: 422 })
    expect(append).not.toHaveBeenCalled()

    await manager.writeCollection(`/chat/session-1`, `comments`, {
      operation: `insert`,
      key: `c2`,
      value: { body: `valid` },
      principal,
    })
    expect(append).toHaveBeenCalledTimes(1)
  })

  it(`rejects writes to a stopped entity with 409`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `stopped`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:comments': {} },
      externally_writable_collections: {
        comments: { type: `state:comments` },
      },
    })

    await expect(
      manager.writeCollection(`/chat/session-1`, `comments`, {
        operation: `insert`,
        key: `c1`,
        value: { body: `hi` },
        principal,
      })
    ).rejects.toMatchObject({ status: 409 })
    expect(append).not.toHaveBeenCalled()
  })

  it(`rejects operations outside the collection allowlist with 403`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:comments': {} },
      externally_writable_collections: {
        comments: { type: `state:comments`, operations: [`insert`] },
      },
    })

    for (const operation of [`update`, `delete`] as const) {
      await expect(
        manager.writeCollection(`/chat/session-1`, `comments`, {
          operation,
          key: `c1`,
          value: { body: `hi` },
          principal,
        })
      ).rejects.toMatchObject({ status: 403 })
    }
    expect(append).not.toHaveBeenCalled()
  })

  it(`defaults to insert-only when no operations allowlist is configured`, async () => {
    const append = vi.fn()
    const { manager } = createAttachmentManager({ streamClient: { append } })
    manager.registry.getEntity = vi.fn().mockResolvedValue({
      url: `/chat/session-1`,
      type: `chat`,
      status: `running`,
      streams: { main: `/chat/session-1` },
    })
    manager.registry.getEntityType = vi.fn().mockResolvedValue({
      name: `chat`,
      state_schemas: { 'state:comments': {} },
      externally_writable_collections: {
        comments: { type: `state:comments` },
      },
    })

    await expect(
      manager.writeCollection(`/chat/session-1`, `comments`, {
        operation: `delete`,
        key: `c1`,
        principal,
      })
    ).rejects.toMatchObject({ status: 403 })
    expect(append).not.toHaveBeenCalled()
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
      replaceSharedStateLink: vi.fn(),
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
