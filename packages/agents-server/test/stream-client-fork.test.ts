import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'

import { StreamClient } from '../src/stream-client'

describe(`StreamClient.fork`, () => {
  let dsServer: DurableStreamTestServer | null = null
  let client: StreamClient

  beforeAll(async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 500,
      webhooks: true,
    })
    const baseUrl = await dsServer.start()
    client = new StreamClient(baseUrl)
  })

  afterAll(async () => {
    await dsServer?.stop()
  })

  it(`forks JSON streams so JSON appends to the fork are accepted`, async () => {
    await client.create(`/source-json`, {
      contentType: `application/json`,
      body: `[]`,
    })

    await client.fork(`/fork-json`, `/source-json`)

    await expect(
      client.append(`/fork-json`, JSON.stringify({ type: `reconcile` }))
    ).resolves.toEqual({ offset: expect.any(String) })
  })

  it(`preserves source history when reading the fork`, async () => {
    const sourceEvent = {
      type: `message_received`,
      key: `msg-in-original`,
      headers: { operation: `insert` },
      value: { payload: { text: `original message` } },
    }
    await client.create(`/source-history`, {
      contentType: `application/json`,
      body: JSON.stringify([sourceEvent]),
    })

    await client.fork(`/fork-history`, `/source-history`)

    await expect(client.readJson(`/fork-history`)).resolves.toMatchObject([
      sourceEvent,
    ])
  })
})
