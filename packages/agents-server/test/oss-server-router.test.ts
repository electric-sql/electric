import { describe, expect, it, vi } from 'vitest'
import { globalRouter } from '../src/routing/global-router'
import { ossServerRouter } from '../src/routing/oss-server-router'
import type { TenantContext } from '../src/routing/context'
import type { OssServerContext } from '../src/routing/oss-server-router'

function request(method: string, path: string): Request {
  return new Request(`http://server${path}`, { method })
}

function buildTenantContext(
  overrides: Partial<TenantContext> = {}
): TenantContext {
  return {
    service: `tenant-test`,
    principal: {
      kind: `system`,
      id: `framework`,
      key: `system:framework`,
      url: `/principal/system:framework`,
    },
    publicUrl: `http://server`,
    durableStreamsUrl: `http://durable.local/v1/stream/tenant-test`,
    durableStreamsDispatcher: undefined as any,
    pgDb: undefined as any,
    entityManager: undefined as any,
    streamClient: undefined as any,
    runtime: undefined as any,
    entityBridgeManager: {
      beginClientRead: vi.fn().mockResolvedValue(vi.fn()),
      touchByStreamPath: vi.fn(),
    } as any,
    isShuttingDown: () => false,
    ...overrides,
  }
}

function buildOssContext(
  overrides: Partial<OssServerContext> = {}
): OssServerContext {
  return {
    ...buildTenantContext(overrides),
    ...overrides,
  } as OssServerContext
}

describe(`OSS server routing wrapper`, () => {
  it(`keeps the exported global router free of the UI redirect`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(null, { status: 204 }))

    try {
      const response = await globalRouter.fetch(
        request(`GET`, `/`),
        buildTenantContext()
      )

      expect(response.status).toBe(204)
      expect(response.headers.get(`location`)).toBeNull()
      expect(fetchSpy).toHaveBeenCalledOnce()
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        `http://durable.local/v1/stream/tenant-test`
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`routes pg-sync stream reads to Durable Streams while keeping registration internal and writes blocked`, async () => {
    const fetchSpy = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`[]`, { status: 200 }))
    const pgSyncBridgeManager = {
      register: vi.fn().mockResolvedValue({
        sourceRef: `abc123`,
        streamUrl: `/_electric/pg-sync/abc123`,
      }),
    }

    try {
      const readResponse = await globalRouter.fetch(
        request(`GET`, `/_electric/pg-sync/abc123?offset=-1`),
        buildTenantContext()
      )

      expect(readResponse.status).toBe(200)
      expect(String(fetchSpy.mock.calls[0]![0])).toBe(
        `http://durable.local/v1/stream/tenant-test/_electric/pg-sync/abc123?offset=-1`
      )

      const headResponse = await globalRouter.fetch(
        request(`HEAD`, `/_electric/pg-sync/abc123`),
        buildTenantContext()
      )

      expect(headResponse.status).toBe(200)
      expect(String(fetchSpy.mock.calls[1]![0])).toBe(
        `http://durable.local/v1/stream/tenant-test/_electric/pg-sync/abc123`
      )

      const writeResponse = await globalRouter.fetch(
        new Request(`http://server/_electric/pg-sync/abc123`, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({ type: `pg_sync_change`, key: `forged` }),
        }),
        buildTenantContext()
      )

      expect(writeResponse.status).toBe(404)
      expect(fetchSpy).toHaveBeenCalledTimes(2)

      const registerResponse = await globalRouter.fetch(
        new Request(`http://server/_electric/pg-sync/register`, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            options: {
              url: `https://electric.example/v1/shape`,
              table: `entities`,
            },
          }),
        }),
        buildTenantContext({ pgSyncBridgeManager: pgSyncBridgeManager as any })
      )

      expect(registerResponse.status).toBe(200)
      expect(pgSyncBridgeManager.register).toHaveBeenCalledWith(
        {
          url: `https://electric.example/v1/shape`,
          table: `entities`,
        },
        {
          tenantId: `tenant-test`,
          principalKind: `system`,
          principalId: `framework`,
          principalKey: `system:framework`,
          principalUrl: `/principal/system:framework`,
        }
      )
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`keeps the exported global router free of the mock agent handler`, async () => {
    const runtime = {
      handleWebhookRequest: vi
        .fn()
        .mockResolvedValue(new Response(`mock`, { status: 201 })),
    }

    const response = await globalRouter.fetch(
      request(`POST`, `/_electric/mock-agent-handler`),
      {
        ...buildTenantContext(),
        mockAgent: { runtime },
      } as unknown as TenantContext
    )

    expect(response.status).toBe(404)
    expect(runtime.handleWebhookRequest).not.toHaveBeenCalled()
  })

  it(`adds the dashboard redirect in the OSS wrapper`, async () => {
    const fetchSpy = vi.spyOn(globalThis, `fetch`)

    try {
      const response = await ossServerRouter.fetch(
        request(`GET`, `/`),
        buildOssContext()
      )

      expect(response.status).toBe(302)
      expect(response.headers.get(`location`)).toBe(`/__agent_ui/`)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`serves the dashboard at the canonical trailing-slash path`, async () => {
    const response = await ossServerRouter.fetch(
      request(`GET`, `/__agent_ui/`),
      buildOssContext()
    )

    expect(response.status).toBe(200)
    expect(response.headers.get(`location`)).toBeNull()
    expect(response.headers.get(`content-type`)).toContain(`text/html`)
  })

  it(`serves the dashboard at the no-slash path without falling through`, async () => {
    const fetchSpy = vi.spyOn(globalThis, `fetch`)

    try {
      const response = await ossServerRouter.fetch(
        request(`GET`, `/__agent_ui`),
        buildOssContext()
      )

      expect(response.status).toBe(200)
      expect(response.headers.get(`location`)).toBeNull()
      expect(response.headers.get(`content-type`)).toContain(`text/html`)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it(`adds the mock agent handler in the OSS wrapper`, async () => {
    const runtime = {
      handleWebhookRequest: vi
        .fn()
        .mockResolvedValue(new Response(`mock`, { status: 201 })),
    }

    const response = await ossServerRouter.fetch(
      request(`POST`, `/_electric/mock-agent-handler`),
      buildOssContext({ mockAgent: { runtime: runtime as any } })
    )

    expect(response.status).toBe(201)
    expect(await response.text()).toBe(`mock`)
    expect(runtime.handleWebhookRequest).toHaveBeenCalledOnce()
  })

  it(`returns 404 from the OSS mock route when no mock agent is configured`, async () => {
    const response = await ossServerRouter.fetch(
      request(`POST`, `/_electric/mock-agent-handler`),
      buildOssContext()
    )

    expect(response.status).toBe(404)
  })
})
