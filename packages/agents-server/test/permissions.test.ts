import { describe, expect, it, vi } from 'vitest'
import {
  canAccessEntity,
  canAccessEntityType,
  canAccessSharedState,
} from '../src/permissions'
import type {
  ElectricAgentsEntity,
  ElectricAgentsEntityType,
} from '../src/electric-agents-types'
import type { Principal } from '../src/principal'
import type { TenantContext } from '../src/routing/context'

const owner: Principal = {
  kind: `user`,
  id: `owner`,
  key: `user:owner`,
  url: `/principal/user%3Aowner`,
}

const reader: Principal = {
  kind: `user`,
  id: `reader`,
  key: `user:reader`,
  url: `/principal/user%3Areader`,
}

const agent: Principal = {
  kind: `agent`,
  id: `worker`,
  key: `agent:worker`,
  url: `/principal/agent%3Aworker`,
}

function entity(url = `/task/one`, createdBy = owner.url) {
  return {
    url,
    type: `task`,
    status: `idle`,
    streams: { main: `${url}/main`, error: `${url}/error` },
    subscription_id: `task-sub`,
    write_token: `token`,
    tags: {},
    created_by: createdBy,
    created_at: 1,
    updated_at: 1,
  } satisfies ElectricAgentsEntity
}

const entityType = {
  name: `task`,
  description: `Task`,
  revision: 1,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
} satisfies ElectricAgentsEntityType

function ctx(
  principal: Principal,
  opts: {
    entityGrant?: boolean
    typeGrant?: boolean
    linkedEntity?: ElectricAgentsEntity | null
    authorizeRequest?: TenantContext[`authorizeRequest`]
  } = {}
): TenantContext {
  const linked = opts.linkedEntity ?? entity(`/task/shared`, reader.url)
  return {
    service: `tenant-test`,
    principal,
    publicUrl: `http://agents.test`,
    durableStreamsUrl: `http://streams.test`,
    durableStreamsDispatcher: {} as never,
    pgDb: {} as never,
    entityManager: {
      registry: {
        pruneExpiredPermissionGrants: vi.fn(async () => undefined),
        hasEntityPermission: vi.fn(async () => opts.entityGrant ?? false),
        hasEntityTypePermission: vi.fn(async () => opts.typeGrant ?? false),
        listSharedStateLinkedEntityUrls: vi.fn(async () =>
          linked ? [linked.url] : []
        ),
        getEntity: vi.fn(async (url: string) =>
          linked && url === linked.url ? linked : null
        ),
      },
    } as never,
    streamClient: {} as never,
    runtime: {} as never,
    entityBridgeManager: {} as never,
    authorizeRequest: opts.authorizeRequest,
    isShuttingDown: () => false,
  }
}

describe(`permission service`, () => {
  it(`allows the creator by default and denies unrelated principals`, async () => {
    const owned = entity()

    expect(await canAccessEntity(ctx(owner), owned, `read`)).toBe(true)
    expect(await canAccessEntity(ctx(owner), owned, `delete`)).toBe(true)
    expect(await canAccessEntity(ctx(reader), owned, `read`)).toBe(false)
  })

  it(`allows entity and type access through explicit grants`, async () => {
    const shared = entity(`/task/shared`, owner.url)

    expect(
      await canAccessEntity(ctx(reader, { entityGrant: true }), shared, `read`)
    ).toBe(true)
    expect(
      await canAccessEntityType(
        ctx(reader, { typeGrant: true }),
        entityType,
        `spawn`
      )
    ).toBe(true)
    expect(await canAccessEntityType(ctx(agent), entityType, `spawn`)).toBe(
      false
    )
  })

  it(`authorizes shared state through any readable linked entity`, async () => {
    expect(await canAccessSharedState(ctx(reader), `board-1`, `read`)).toBe(
      true
    )
    expect(
      await canAccessSharedState(
        ctx(reader, { linkedEntity: entity(`/task/shared`, owner.url) }),
        `board-1`,
        `read`
      )
    ).toBe(false)
  })

  it(`lets the webhook escape hatch deny and cache point decisions`, async () => {
    const hook = vi.fn(() => ({
      decision: `deny` as const,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }))
    const request = new Request(
      `http://agents.test/_electric/entities/task/one`
    )
    const owned = entity()
    const hookCtx = ctx(owner, { authorizeRequest: hook })

    expect(await canAccessEntity(hookCtx, owned, `read`, request)).toBe(false)
    expect(await canAccessEntity(hookCtx, owned, `read`, request)).toBe(false)
    expect(hook).toHaveBeenCalledTimes(1)
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: `tenant-test`,
        principal: owner,
        verb: `read`,
        builtInAllowed: true,
        resource: { kind: `entity`, entity: owned },
      })
    )
  })
})
