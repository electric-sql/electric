import { describe, expect, it, vi } from 'vitest'
import {
  getPgSyncStreamPath,
  sourceRefForPgSync,
} from '@electric-ax/agents-runtime'
import { globalRouter } from '../src/routing/global-router'
import type { TenantContext } from '../src/routing/context'

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://server${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function buildContext(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    service: `tenant-test`,
    principal: {
      kind: `user`,
      id: `owner@example.com`,
      key: `user:owner@example.com`,
      url: `/principal/user%3Aowner%40example.com`,
    },
    publicUrl: `http://server`,
    durableStreamsUrl: `http://durable.local`,
    durableStreamsDispatcher: undefined as any,
    pgDb: undefined as any,
    entityManager: undefined as any,
    streamClient: {
      ensure: vi.fn(async () => undefined),
    } as any,
    runtime: undefined as any,
    entityBridgeManager: undefined as any,
    pgSyncBridgeManager: {
      start: vi.fn(async () => undefined),
      register: vi.fn(async (options) => ({
        sourceRef: sourceRefForPgSync(options),
        streamUrl: getPgSyncStreamPath(sourceRefForPgSync(options)),
      })),
      stop: vi.fn(async () => undefined),
    },
    isShuttingDown: () => false,
    ...overrides,
  }
}

describe(`pg-sync routes`, () => {
  it(`registers a pg-sync source and returns its stream path`, async () => {
    const ctx = buildContext()
    const expectedSourceRef = sourceRefForPgSync({ table: `todos` })
    const expectedStreamUrl = getPgSyncStreamPath(expectedSourceRef)

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/pg-sync/register`, {
        options: { table: `todos` },
      }),
      ctx
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      sourceRef: expectedSourceRef,
      streamUrl: expectedStreamUrl,
    })
    expect(ctx.pgSyncBridgeManager!.register).toHaveBeenCalledWith(
      { table: `todos` },
      { tenantId: `tenant-test`, principalKey: `user:owner@example.com` }
    )
  })

  it(`rejects an empty table`, async () => {
    const ctx = buildContext()

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/pg-sync/register`, {
        options: { table: `   ` },
      }),
      ctx
    )

    expect(response.status).toBe(400)
    expect(ctx.pgSyncBridgeManager!.register).not.toHaveBeenCalled()
  })

  it(`computes the same sourceRef as the runtime pgSync helper`, async () => {
    const ctx = buildContext()
    const options = {
      table: `todos`,
      where: `priority = 'high'`,
      params: { b: `2`, a: `1` },
      replica: `full` as const,
    }

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/pg-sync/register`, { options }),
      ctx
    )
    const body = (await response.json()) as { sourceRef: string }

    expect(response.status).toBe(200)
    expect(body.sourceRef).toBe(sourceRefForPgSync(options))
  })
})
