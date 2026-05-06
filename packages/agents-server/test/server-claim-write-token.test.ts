import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from '../src/server'
import { consumerCallbacks } from '../src/db/schema'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'
import type { Server } from 'node:http'

describe(`Claim-scoped write tokens`, () => {
  let dsServer: DurableStreamTestServer
  let electricAgentsServer: ElectricAgentsServer | null = null
  let baseUrl = ``
  let receiver: Server
  let receiverUrl = ``

  async function startElectricAgentsServer(): Promise<void> {
    electricAgentsServer = new ElectricAgentsServer({
      durableStreamsUrl: dsServer.url,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      electricUrl: TEST_ELECTRIC_URL,
    })
    baseUrl = await electricAgentsServer.start()
  }

  async function stopElectricAgentsServer(): Promise<void> {
    if (!electricAgentsServer) return
    await electricAgentsServer.stop()
    electricAgentsServer = null
    baseUrl = ``
  }

  async function createEntity(
    typeName: string,
    instanceId: string,
    typeBody?: Record<string, unknown>
  ): Promise<{
    url: string
    streams: { main: string }
  }> {
    const typeRes = await fetch(`${baseUrl}/_electric/entity-types`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        name: typeName,
        description: `${typeName} test type`,
        ...typeBody,
      }),
    })
    expect(typeRes.status).toBe(201)

    const entityRes = await fetch(`${baseUrl}/${typeName}/${instanceId}`, {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    expect(entityRes.status).toBe(201)

    const entity = (await entityRes.json()) as {
      url: string
      streams: { main: string }
    }

    return {
      ...entity,
    }
  }

  async function appendEntityEvent(opts: {
    streamPath: string
    writeToken: string
    event?: Record<string, unknown>
    key: string
  }): Promise<Response> {
    return await fetch(`${baseUrl}${opts.streamPath}`, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer ${opts.writeToken}`,
      },
      body: JSON.stringify(
        opts.event ?? {
          type: `manifest`,
          key: opts.key,
          value: {
            key: opts.key,
            kind: `schedule`,
            id: opts.key,
            scheduleType: `future_send`,
            fireAt: new Date(Date.now() + 60_000).toISOString(),
            targetUrl: `/noop`,
            payload: {},
            status: `pending`,
          },
          headers: {
            operation: `insert`,
          },
        }
      ),
    })
  }

  async function claimEntityConsumer(opts: {
    streamPath: string
    consumerId: string
    epoch?: number
    wakeId?: string
  }): Promise<{
    ok: boolean
    writeToken?: string
  }> {
    const pgDb = (electricAgentsServer as any).pgDb

    await pgDb.insert(consumerCallbacks).values({
      consumerId: opts.consumerId,
      callbackUrl: receiverUrl,
      primaryStream: opts.streamPath,
    })

    return await claimConsumer({
      consumerId: opts.consumerId,
      epoch: opts.epoch ?? 4,
      wakeId: opts.wakeId ?? `wake-${opts.consumerId}`,
    })
  }

  async function claimConsumer(opts: {
    consumerId: string
    epoch: number
    wakeId: string
  }): Promise<{
    ok: boolean
    writeToken?: string
  }> {
    const claimRes = await fetch(
      `${baseUrl}/_electric/callback-forward/${encodeURIComponent(opts.consumerId)}`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          epoch: opts.epoch,
          wakeId: opts.wakeId,
        }),
      }
    )
    expect(claimRes.status).toBe(200)
    return (await claimRes.json()) as {
      ok: boolean
      writeToken?: string
    }
  }

  async function sendDone(opts: {
    consumerId: string
    epoch: number
    streamPath: string
  }): Promise<Response> {
    return await fetch(
      `${baseUrl}/_electric/callback-forward/${encodeURIComponent(opts.consumerId)}`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          done: true,
          epoch: opts.epoch,
          acks: [{ path: opts.streamPath, offset: `0_0` }],
        }),
      }
    )
  }

  async function getEntityStatus(entityUrl: string): Promise<string> {
    const res = await fetch(`${baseUrl}${entityUrl}`)
    expect(res.status).toBe(200)
    const entity = (await res.json()) as { status: string }
    return entity.status
  }

  async function expectTags(
    entityUrl: string,
    expected: Record<string, string>
  ): Promise<void> {
    const entityRes = await fetch(`${baseUrl}${entityUrl}`)
    expect(entityRes.status).toBe(200)
    const updatedEntity = (await entityRes.json()) as {
      tags: Record<string, string>
    }
    expect(updatedEntity.tags).toEqual(expected)
  }

  function stateEvent(opts: {
    key: string
    type?: string
    value?: Record<string, unknown>
    headers?: Record<string, unknown>
  }): Record<string, unknown> {
    return {
      type: opts.type ?? `default`,
      key: opts.key,
      value: opts.value ?? { data: `test` },
      headers: {
        operation: `insert`,
        ...opts.headers,
      },
    }
  }

  beforeAll(async () => {
    receiver = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': `application/json` })
      res.end(JSON.stringify({ ok: true }))
    })

    const receiverReady = new Promise<void>((resolve) =>
      receiver.listen(0, `127.0.0.1`, () => resolve())
    )

    dsServer = new DurableStreamTestServer({
      port: 0,
      webhooks: true,
    })

    await Promise.all([
      resetElectricAgentsTestBackend(),
      dsServer.start(),
      receiverReady,
    ])

    const address = receiver.address() as { port: number }
    receiverUrl = `http://127.0.0.1:${address.port}`
    await startElectricAgentsServer()
  }, 120_000)

  afterAll(async () => {
    receiver.closeAllConnections()
    await Promise.allSettled([
      stopElectricAgentsServer(),
      dsServer.stop(),
      new Promise<void>((resolve) => receiver.close(() => resolve())),
    ])
  }, 120_000)

  it(`rotates claim write tokens and rejects entity tokens without an active claim`, async () => {
    const typeName = `claim-writer-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)
    const pgDb = (electricAgentsServer as any).pgDb
    const registry = (electricAgentsServer as any).registry
    const entityRow = await registry.getEntity(entity.url)
    const entityWriteToken = entityRow.write_token as string

    await pgDb.insert(consumerCallbacks).values([
      {
        consumerId: `consumer-one`,
        callbackUrl: receiverUrl,
        primaryStream: entity.streams.main,
      },
      {
        consumerId: `consumer-two`,
        callbackUrl: receiverUrl,
        primaryStream: entity.streams.main,
      },
    ])

    const firstClaim = await claimConsumer({
      consumerId: `consumer-one`,
      epoch: 4,
      wakeId: `wake-1`,
    })
    expect(firstClaim.ok).toBe(true)
    expect(firstClaim.writeToken).toBeTruthy()
    expect(firstClaim.writeToken).not.toBe(entityWriteToken)

    const originalTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: entityWriteToken,
      key: `manifest-original-token`,
    })
    expect(originalTokenRes.status).toBe(401)

    const firstClaimTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: firstClaim.writeToken!,
      key: `manifest-claim-one`,
    })
    expect(firstClaimTokenRes.status).toBe(204)

    const secondClaim = await claimConsumer({
      consumerId: `consumer-two`,
      epoch: 5,
      wakeId: `wake-2`,
    })
    expect(secondClaim.ok).toBe(true)
    expect(secondClaim.writeToken).toBeTruthy()
    expect(secondClaim.writeToken).not.toBe(firstClaim.writeToken)

    const staleClaimRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: firstClaim.writeToken!,
      key: `manifest-stale-claim`,
    })
    expect(staleClaimRes.status).toBe(401)

    const secondClaimTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: secondClaim.writeToken!,
      key: `manifest-claim-two`,
    })
    expect(secondClaimTokenRes.status).toBe(204)

    const doneRes = await sendDone({
      consumerId: `consumer-two`,
      epoch: 5,
      streamPath: entity.streams.main,
    })
    expect(doneRes.status).toBe(200)

    const revokedClaimTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: secondClaim.writeToken!,
      key: `manifest-revoked-claim-token`,
    })
    expect(revokedClaimTokenRes.status).toBe(401)

    const restoredEntityTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: entityWriteToken,
      key: `manifest-restored-entity-token`,
    })
    expect(restoredEntityTokenRes.status).toBe(401)
  }, 20_000)

  it(`stale done does not mark a newer active claim idle`, async () => {
    const typeName = `claim-done-race-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)
    const pgDb = (electricAgentsServer as any).pgDb
    const registry = (electricAgentsServer as any).registry

    await pgDb.insert(consumerCallbacks).values([
      {
        consumerId: `consumer-old`,
        callbackUrl: receiverUrl,
        primaryStream: entity.streams.main,
      },
      {
        consumerId: `consumer-new`,
        callbackUrl: receiverUrl,
        primaryStream: entity.streams.main,
      },
    ])

    const oldClaim = await claimConsumer({
      consumerId: `consumer-old`,
      epoch: 4,
      wakeId: `wake-old`,
    })
    expect(oldClaim.writeToken).toBeTruthy()

    const newClaim = await claimConsumer({
      consumerId: `consumer-new`,
      epoch: 5,
      wakeId: `wake-new`,
    })
    expect(newClaim.writeToken).toBeTruthy()

    await registry.updateStatus(entity.url, `running`)
    expect(await getEntityStatus(entity.url)).toBe(`running`)

    const staleDoneRes = await sendDone({
      consumerId: `consumer-old`,
      epoch: 4,
      streamPath: entity.streams.main,
    })
    expect(staleDoneRes.status).toBe(200)

    expect(await getEntityStatus(entity.url)).toBe(`running`)

    const staleOwnerTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: oldClaim.writeToken!,
      key: `manifest-old-owner-after-stale-done`,
    })
    expect(staleOwnerTokenRes.status).toBe(401)

    const currentOwnerTokenRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: newClaim.writeToken!,
      key: `manifest-current-owner-after-stale-done`,
    })
    expect(currentOwnerTokenRes.status).toBe(204)
  }, 20_000)

  it(`kill clears the active claim token for the entity stream`, async () => {
    const typeName = `claim-kill-cleanup-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)
    const pgDb = (electricAgentsServer as any).pgDb

    await pgDb.insert(consumerCallbacks).values({
      consumerId: `consumer-kill`,
      callbackUrl: receiverUrl,
      primaryStream: entity.streams.main,
    })

    const claim = await claimConsumer({
      consumerId: `consumer-kill`,
      epoch: 4,
      wakeId: `wake-kill`,
    })
    expect(claim.ok).toBe(true)
    expect(claim.writeToken).toBeTruthy()

    const claimMap = (electricAgentsServer as any)
      .activeClaimWriteTokens as Map<string, { token: string }>
    const claimMapByConsumer = (electricAgentsServer as any)
      .activeClaimWriteTokensByConsumer as Map<string, string>
    expect(claimMap.get(entity.streams.main)?.token).toBe(claim.writeToken)
    expect(claimMapByConsumer.get(`consumer-kill`)).toBe(entity.streams.main)

    const killRes = await fetch(`${baseUrl}${entity.url}`, {
      method: `DELETE`,
    })
    expect(killRes.status).toBe(200)

    expect(claimMap.has(entity.streams.main)).toBe(false)
    expect(claimMapByConsumer.has(`consumer-kill`)).toBe(false)
  }, 20_000)

  it(`tag writes accept the active claim token`, async () => {
    const typeName = `claim-tag-write-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)

    const claim = await claimEntityConsumer({
      streamPath: entity.streams.main,
      consumerId: `consumer-tags`,
      wakeId: `wake-tags`,
    })
    expect(claim.ok).toBe(true)
    expect(claim.writeToken).toBeTruthy()

    const setTagRes = await fetch(`${baseUrl}${entity.url}/tags/title`, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer ${claim.writeToken}`,
      },
      body: JSON.stringify({ value: `Onboarding` }),
    })
    expect(setTagRes.status).toBe(200)

    await expectTags(entity.url, { title: `Onboarding` })
  }, 20_000)

  it(`claim-scoped writes validate state schemas and unknown event types`, async () => {
    const typeName = `claim-write-schemas-${Date.now()}`
    const entity = await createEntity(typeName, `owner`, {
      output_schemas: {
        result: {
          type: `object`,
          properties: { value: { type: `number` } },
          required: [`value`],
        },
      },
    })

    const claim = await claimEntityConsumer({
      streamPath: entity.streams.main,
      consumerId: `consumer-write-schema`,
    })
    expect(claim.writeToken).toBeTruthy()

    const invalidSchemaRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: claim.writeToken!,
      key: `invalid-schema`,
      event: stateEvent({
        type: `result`,
        key: `invalid-schema`,
        value: { wrong: `type` },
      }),
    })
    expect(invalidSchemaRes.status).toBe(422)
    const invalidSchemaBody = (await invalidSchemaRes.json()) as {
      error: { code: string }
    }
    expect(invalidSchemaBody.error.code).toBe(`SCHEMA_VALIDATION_FAILED`)

    const unknownTypeRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: claim.writeToken!,
      key: `unknown-type`,
      event: stateEvent({
        type: `unknown_event`,
        key: `unknown-type`,
      }),
    })
    expect(unknownTypeRes.status).toBe(422)
    const unknownTypeBody = (await unknownTypeRes.json()) as {
      error: { code: string }
    }
    expect(unknownTypeBody.error.code).toBe(`UNKNOWN_EVENT_TYPE`)
  }, 20_000)

  it(`claim-scoped writes accept arbitrary events when no state schemas exist`, async () => {
    const typeName = `claim-write-no-schemas-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)

    const claim = await claimEntityConsumer({
      streamPath: entity.streams.main,
      consumerId: `consumer-write-no-schemas`,
    })
    expect(claim.writeToken).toBeTruthy()

    const writeRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: claim.writeToken!,
      key: `no-schemas`,
      event: stateEvent({
        key: `no-schemas`,
        value: { anything: `goes` },
      }),
    })
    expect(writeRes.status).toBe(204)
  }, 20_000)

  it(`claim-scoped writes to stopped entities are rejected`, async () => {
    const typeName = `claim-write-stopped-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)

    const claim = await claimEntityConsumer({
      streamPath: entity.streams.main,
      consumerId: `consumer-write-stopped`,
    })
    expect(claim.writeToken).toBeTruthy()

    const killRes = await fetch(`${baseUrl}${entity.url}`, {
      method: `DELETE`,
    })
    expect(killRes.status).toBe(200)

    const writeRes = await appendEntityEvent({
      streamPath: entity.streams.main,
      writeToken: claim.writeToken!,
      key: `stopped-write`,
      event: stateEvent({
        key: `stopped-write`,
      }),
    })
    expect(writeRes.status).toBe(401)
  }, 20_000)

  it(`claim-scoped tag writes reject non-string values and support merge/delete`, async () => {
    const typeName = `claim-tag-semantics-${Date.now()}`
    const entity = await createEntity(typeName, `owner`)

    const claim = await claimEntityConsumer({
      streamPath: entity.streams.main,
      consumerId: `consumer-tag-semantics`,
    })
    expect(claim.writeToken).toBeTruthy()

    const invalidTagRes = await fetch(`${baseUrl}${entity.url}/tags/owner`, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer ${claim.writeToken}`,
      },
      body: JSON.stringify({ value: 123 }),
    })
    expect(invalidTagRes.status).toBe(400)

    for (const [key, value] of [
      [`key1`, `value1`],
      [`key2`, `value2`],
      [`key2`, `updated`],
      [`key3`, `value3`],
    ] as const) {
      const res = await fetch(`${baseUrl}${entity.url}/tags/${key}`, {
        method: `POST`,
        headers: {
          'content-type': `application/json`,
          authorization: `Bearer ${claim.writeToken}`,
        },
        body: JSON.stringify({ value }),
      })
      expect(res.status).toBe(200)
    }

    await expectTags(entity.url, {
      key1: `value1`,
      key2: `updated`,
      key3: `value3`,
    })

    const deleteTagRes = await fetch(`${baseUrl}${entity.url}/tags/key2`, {
      method: `DELETE`,
      headers: {
        authorization: `Bearer ${claim.writeToken}`,
      },
    })
    expect(deleteTagRes.status).toBe(200)

    await expectTags(entity.url, {
      key1: `value1`,
      key3: `value3`,
    })
  }, 20_000)
})
