import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DurableStreamTestServer } from '@durable-streams/server'

import { StreamClient } from '../src/stream-client'
import { durableStreamTestServerUrl } from './test-utils'

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
    client = new StreamClient(durableStreamTestServerUrl(baseUrl))
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
      type: `inbox`,
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

  it(`forks at a sub-offset to truncate source history`, async () => {
    // The durable-streams TS server treats one POST as one message,
    // regardless of content type — so writing the source as a single
    // body=JSON.stringify([a,b,c]) creates ONE flattened message of
    // three JSON values. Sub-offset 2 then slices that to two values.
    await client.create(`/source-sub-offset`, {
      contentType: `application/json`,
      body: JSON.stringify([
        { key: `a`, value: 1 },
        { key: `b`, value: 2 },
        { key: `c`, value: 3 },
      ]),
    })

    await client.fork(`/fork-truncated`, `/source-sub-offset`, {
      forkPointer: { offset: null, subOffset: 2 },
    })

    await expect(client.readJson(`/fork-truncated`)).resolves.toEqual([
      { key: `a`, value: 1 },
      { key: `b`, value: 2 },
    ])
  })
})
