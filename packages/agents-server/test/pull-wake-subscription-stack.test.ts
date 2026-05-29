import { createServer } from 'node:http'
import { createServerAdapter } from '@whatwg-node/server'
import { stream } from '@durable-streams/client'
import { DurableStreamTestServer } from '@durable-streams/server'
import { afterEach, describe, expect, it } from 'vitest'
import { globalRouter } from '../src/routing/global-router'
import { StreamClient } from '../src/stream-client'
import { durableStreamTestServerUrl } from './test-utils'
import type { Server } from 'node:http'
import type { TenantContext } from '../src/routing/context'

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function readJsonStream<T>(
  baseUrl: string,
  path: string
): Promise<Array<T>> {
  const res = await stream<T>({
    url: `${baseUrl}${path}`,
    offset: `-1`,
    live: false,
  })
  return await res.json()
}

describe(`pull-wake subscription stack`, () => {
  let dsServer: DurableStreamTestServer | undefined
  let proxyServer: Server | undefined

  afterEach(async () => {
    await Promise.allSettled([
      proxyServer ? closeServer(proxyServer) : undefined,
      dsServer?.stop(),
    ])
    proxyServer = undefined
    dsServer = undefined
  })

  it(`emits and claims runner wakes through Durable Streams subscriptions`, async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 100,
      webhooks: true,
    })
    await dsServer.start()
    const streamBaseUrl = durableStreamTestServerUrl(dsServer.url)
    const client = new StreamClient(streamBaseUrl)

    await client.ensure(`/runners/runner-1/wake`, {
      contentType: `application/json`,
    })
    await client.ensure(`/horton/one/main`, {
      contentType: `application/json`,
    })
    await client.putSubscription(`runner:runner-1:one`, {
      type: `pull-wake`,
      streams: [`/horton/one/main`],
      wake_stream: `/runners/runner-1/wake`,
    })

    await client.append(
      `/horton/one/main`,
      JSON.stringify({ type: `message`, value: `hello` })
    )

    const wakes = await readJsonStream<Record<string, unknown>>(
      streamBaseUrl,
      `/runners/runner-1/wake`
    )
    expect(wakes).toEqual([
      expect.objectContaining({
        type: `wake`,
        subscription_id: `runner:runner-1:one`,
        stream: `horton/one/main`,
        generation: 1,
      }),
    ])

    await expect(
      client.claimSubscription(`runner:runner-1:one`, `worker-1`)
    ).resolves.toMatchObject({
      wake_id: expect.any(String),
      generation: 1,
      token: expect.any(String),
      streams: [
        expect.objectContaining({
          path: `horton/one/main`,
          has_pending: true,
        }),
      ],
    })
  })

  it(`proxies pre-existing runner wake events to pull-wake runners`, async () => {
    dsServer = new DurableStreamTestServer({
      port: 0,
      longPollTimeout: 100,
      webhooks: true,
    })
    await dsServer.start()
    const streamBaseUrl = durableStreamTestServerUrl(dsServer.url)
    const client = new StreamClient(streamBaseUrl)
    await client.ensure(`/runners/runner-1/wake`, {
      contentType: `application/json`,
    })
    await client.append(
      `/runners/runner-1/wake`,
      JSON.stringify({
        type: `wake`,
        subscription_id: `runner:runner-1:one`,
        stream: `horton/one/main`,
        generation: 1,
      })
    )

    const ctx = {
      service: `default`,
      principal: {
        kind: `user`,
        id: `owner@example.com`,
        key: `user:owner@example.com`,
        url: `/principal/user%3Aowner%40example.com`,
      },
      publicUrl: `http://agents.local`,
      durableStreamsUrl: streamBaseUrl,
      entityBridgeManager: {
        beginClientRead: async () => null,
        touchByStreamPath: async () => undefined,
      },
      isShuttingDown: () => false,
    } as unknown as TenantContext
    const adapter = createServerAdapter((request) =>
      globalRouter.fetch(request as any, ctx)
    )
    proxyServer = createServer(adapter)
    await new Promise<void>((resolve) =>
      proxyServer!.listen(0, `127.0.0.1`, resolve)
    )
    const address = proxyServer.address()
    if (!address || typeof address === `string`) {
      throw new Error(`Expected TCP test server address`)
    }

    const wakes = await readJsonStream<Record<string, unknown>>(
      `http://127.0.0.1:${address.port}`,
      `/runners/runner-1/wake`
    )
    expect(wakes).toEqual([
      expect.objectContaining({
        type: `wake`,
        subscription_id: `runner:runner-1:one`,
      }),
    ])
  })
})
