import { afterEach, describe, expect, it, vi } from 'vitest'
import { globalRouter } from '../src/routing/global-router'
import type { EntityPermission } from '../src/electric-agents-types'
import type { Principal } from '../src/principal'
import type { TenantContext } from '../src/routing/context'

const owner = {
  kind: `user` as const,
  id: `owner`,
  key: `user:owner`,
  url: `/principal/user%3Aowner`,
}

const reader = {
  kind: `user` as const,
  id: `reader`,
  key: `user:reader`,
  url: `/principal/user%3Areader`,
}

function request(method: string, path: string, body?: unknown): Request {
  return new Request(`http://agents.test${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'content-type': `application/json` },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function entity(url: string, createdBy = owner.url) {
  const type = url.split(`/`)[1] ?? `task`
  return {
    url,
    type,
    status: `idle`,
    streams: { main: `${url}/main` },
    subscription_id: `${type}-sub`,
    write_token: `${url}-token`,
    tags: {},
    created_by: createdBy,
    created_at: 1,
    updated_at: 1,
  }
}

function ctx(
  overrides: {
    principal?: Principal
    hasEntityPermission?: boolean | ((permission: EntityPermission) => boolean)
    hasEntityTypePermission?: boolean
    entityCreatedBy?: string
    parentCreatedBy?: string
    linkedSharedStateEntityUrls?: Array<string>
  } = {}
): TenantContext {
  const taskType = {
    name: `task`,
    description: `Task`,
    revision: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  }
  const currentEntity = entity(`/task/one`, overrides.entityCreatedBy)
  const parentEntity = entity(
    `/task/parent`,
    overrides.parentCreatedBy ?? owner.url
  )
  const linkedEntity = entity(`/task/linked`, owner.url)
  const registry = {
    pruneExpiredPermissionGrants: vi.fn(async () => undefined),
    getEntityType: vi.fn(async (name: string) =>
      name === taskType.name ? taskType : null
    ),
    getEntity: vi.fn(async (url: string) => {
      if (url === currentEntity.url) return currentEntity
      if (url === parentEntity.url) return parentEntity
      if (url === linkedEntity.url) return linkedEntity
      return null
    }),
    getEntityByStream: vi.fn(async (path: string) =>
      path === currentEntity.streams.main ? currentEntity : null
    ),
    listSharedStateLinkedEntityUrls: vi.fn(
      async () => overrides.linkedSharedStateEntityUrls ?? [currentEntity.url]
    ),
    replaceSharedStateLink: vi.fn(async () => undefined),
    hasEntityPermission: vi.fn(async (_url, permission) =>
      typeof overrides.hasEntityPermission === `function`
        ? overrides.hasEntityPermission(permission)
        : (overrides.hasEntityPermission ?? false)
    ),
    hasEntityTypePermission: vi.fn(
      async () => overrides.hasEntityTypePermission ?? false
    ),
    listEntities: vi.fn(async () => ({ entities: [], total: 0 })),
    createEntityPermissionGrant: vi.fn(async (input) => ({
      id: 1,
      entity_url: input.entityUrl,
      subject_kind: input.subjectKind,
      subject_value: input.subjectValue,
      permission: input.permission,
      propagation: input.propagation ?? `self`,
      copy_to_children: input.copyToChildren ?? false,
      created_by: input.createdBy,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    })),
    copyEntityPermissionGrantsForSpawn: vi.fn(async () => []),
    ensureEntityTypePermissionGrant: vi.fn(async (input) => ({
      id: 1,
      entity_type: input.entityType,
      subject_kind: input.subjectKind,
      subject_value: input.subjectValue,
      permission: input.permission,
      created_by: input.createdBy,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    })),
  }

  return {
    service: `tenant-test`,
    principal: overrides.principal ?? reader,
    publicUrl: `http://agents.test`,
    durableStreamsUrl: `http://streams.test`,
    durableStreamsDispatcher: {} as never,
    pgDb: {} as never,
    entityManager: {
      registry,
      ensurePrincipal: vi.fn(async () => undefined),
      registerEntityType: vi.fn(async (input) => ({
        name: input.name,
        description: input.description,
        revision: 1,
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString(),
      })),
      spawn: vi.fn(async (_type, input) =>
        entity(
          `/task/${input.instance_id}`,
          (overrides.principal ?? reader).url
        )
      ),
    } as never,
    streamClient: {} as never,
    runtime: { claimWriteTokens: { clearStream: vi.fn() } } as never,
    entityBridgeManager: {
      beginClientRead: vi.fn(async () => vi.fn(async () => undefined)),
      touchByStreamPath: vi.fn(async () => undefined),
    } as never,
    isShuttingDown: () => false,
  }
}

describe(`permission route middleware`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`denies entity reads without ownership or grants`, async () => {
    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/entities/task/one`),
      ctx()
    )
    expect(response.status).toBe(401)
  })

  it(`allows entity reads through effective grants`, async () => {
    const response = await globalRouter.fetch(
      request(`GET`, `/_electric/entities/task/one`),
      ctx({ hasEntityPermission: true })
    )
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ url: `/task/one` })
  })

  it(`denies spawn without a type spawn grant`, async () => {
    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/task/new`, {}),
      ctx()
    )
    expect(response.status).toBe(401)
  })

  it(`allows users to register new entity types`, async () => {
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entity-types`, {
        name: `custom`,
        description: `Custom`,
      }),
      ctx()
    )
    expect(response.status).toBe(201)
  })

  it(`requires manage permission to update existing entity types through registration`, async () => {
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entity-types`, {
        name: `task`,
        description: `Task update`,
      }),
      ctx()
    )
    expect(response.status).toBe(401)
  })

  it(`materializes registration spawn grants for new entity types`, async () => {
    const context = ctx()
    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/entity-types`, {
        name: `custom`,
        description: `Custom`,
        permission_grants: [
          {
            subject_kind: `principal_kind`,
            subject_value: `user`,
            permission: `spawn`,
          },
        ],
      }),
      context
    )

    expect(response.status).toBe(201)
    expect(
      context.entityManager.registry.ensureEntityTypePermissionGrant
    ).toHaveBeenCalledWith({
      entityType: `custom`,
      subjectKind: `principal_kind`,
      subjectValue: `user`,
      permission: `spawn`,
      expiresAt: undefined,
      createdBy: reader.url,
    })
  })

  it(`requires parent entity spawn permission when spawning a child`, async () => {
    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/task/new`, {
        parent: `/task/parent`,
      }),
      ctx({
        hasEntityTypePermission: true,
        parentCreatedBy: owner.url,
      })
    )
    expect(response.status).toBe(401)
  })

  it(`materializes direct spawn-time grants on the new entity`, async () => {
    const context = ctx({ hasEntityTypePermission: true })
    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/task/new`, {
        grants: [
          {
            subject_kind: `principal`,
            subject_value: owner.url,
            permission: `read`,
          },
        ],
      }),
      context
    )

    expect(response.status).toBe(201)
    expect(
      context.entityManager.registry.createEntityPermissionGrant
    ).toHaveBeenCalledWith({
      entityUrl: `/task/new`,
      subjectKind: `principal`,
      subjectValue: owner.url,
      permission: `read`,
      propagation: undefined,
      copyToChildren: undefined,
      expiresAt: undefined,
      createdBy: reader.url,
    })
  })

  it(`requires parent manage permission for broad parented spawn-time grants`, async () => {
    const context = ctx({
      hasEntityTypePermission: true,
      hasEntityPermission: (permission) => permission === `spawn`,
    })
    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/task/new`, {
        parent: `/task/parent`,
        grants: [
          {
            subject_kind: `principal_kind`,
            subject_value: `user`,
            permission: `read`,
          },
        ],
      }),
      context
    )

    expect(response.status).toBe(401)
    expect(context.entityManager.spawn).not.toHaveBeenCalled()
    expect(
      context.entityManager.registry.createEntityPermissionGrant
    ).not.toHaveBeenCalled()
  })

  it(`allows broad parented spawn-time grants with parent manage permission`, async () => {
    const context = ctx({
      hasEntityTypePermission: true,
      hasEntityPermission: (permission) =>
        permission === `spawn` || permission === `manage`,
    })
    const response = await globalRouter.fetch(
      request(`PUT`, `/_electric/entities/task/new`, {
        parent: `/task/parent`,
        grants: [
          {
            subject_kind: `principal_kind`,
            subject_value: `user`,
            permission: `read`,
          },
        ],
      }),
      context
    )

    expect(response.status).toBe(201)
    expect(
      context.entityManager.registry.createEntityPermissionGrant
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        entityUrl: `/task/new`,
        subjectKind: `principal_kind`,
        subjectValue: `user`,
        permission: `read`,
      })
    )
  })

  it(`denies durable entity stream reads without read permission`, async () => {
    const upstreamFetch = vi.fn(async () => new Response(`ok`))
    vi.stubGlobal(`fetch`, upstreamFetch)

    const response = await globalRouter.fetch(
      request(`GET`, `/task/one/main`),
      ctx()
    )

    expect(response.status).toBe(401)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it(`passes through non-Agents durable stream paths`, async () => {
    const upstreamFetch = vi.fn(async () => new Response(`ok`))
    vi.stubGlobal(`fetch`, upstreamFetch)

    const response = await globalRouter.fetch(
      request(`GET`, `/utility/main`),
      ctx()
    )

    expect(response.status).toBe(200)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it(`authorizes initial shared-state creation through the owner entity`, async () => {
    const upstreamFetch = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal(`fetch`, upstreamFetch)

    const response = await globalRouter.fetch(
      new Request(`http://agents.test/_electric/shared-state/board-1`, {
        method: `PUT`,
        headers: { 'electric-owner-entity': `/task/one` },
      }),
      ctx({ entityCreatedBy: reader.url, linkedSharedStateEntityUrls: [] })
    )

    expect(response.status).toBe(201)
    expect(upstreamFetch).toHaveBeenCalled()
  })

  it(`denies unsupported shared-state methods instead of passing through`, async () => {
    const upstreamFetch = vi.fn(async () => new Response(null, { status: 204 }))
    vi.stubGlobal(`fetch`, upstreamFetch)

    const response = await globalRouter.fetch(
      new Request(`http://agents.test/_electric/shared-state/board-1`, {
        method: `DELETE`,
      }),
      ctx({ linkedSharedStateEntityUrls: [`/task/one`] })
    )

    expect(response.status).toBe(401)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })

  it(`does not let the owner-entity header override existing shared-state links`, async () => {
    const upstreamFetch = vi.fn(async () => new Response(null, { status: 201 }))
    vi.stubGlobal(`fetch`, upstreamFetch)

    const response = await globalRouter.fetch(
      new Request(`http://agents.test/_electric/shared-state/board-1`, {
        method: `PUT`,
        headers: { 'electric-owner-entity': `/task/one` },
      }),
      ctx({
        entityCreatedBy: reader.url,
        linkedSharedStateEntityUrls: [`/task/linked`],
      })
    )

    expect(response.status).toBe(401)
    expect(upstreamFetch).not.toHaveBeenCalled()
  })
})
