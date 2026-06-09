import { describe, expect, it, vi } from 'vitest'
import { AutoRouter } from 'itty-router'
import { ElectricAgentsError } from '../src/entity-manager'
import { ElectricProxyError } from '../src/utils/server-utils'
import { serverLog } from '../src/utils/log'
import {
  applyCors,
  errorMapper,
  otelEndSpan,
  otelStartSpan,
  rejectIfShuttingDown,
} from '../src/routing/hooks'
import type { IRequest } from 'itty-router'
import type { TenantContext } from '../src/routing/context'

function buildCtx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    service: `tenant-test`,
    principal: {
      kind: `system`,
      id: `framework`,
      key: `system:framework`,
      url: `/principal/system:framework`,
    },
    publicUrl: `http://server`,
    durableStreamsUrl: `http://ds`,
    durableStreamsDispatcher: undefined as any,
    pgDb: undefined as any,
    entityManager: undefined as any,
    streamClient: undefined as any,
    runtime: undefined as any,
    entityBridgeManager: undefined as any,
    isShuttingDown: () => false,
    ...overrides,
  }
}

describe(`routing/hooks`, () => {
  it(`applyCors sets wildcard CORS headers on the response`, () => {
    const response = new Response(`hi`, { status: 200 })
    const wrapped = applyCors(response)
    expect(wrapped?.headers.get(`access-control-allow-origin`)).toBe(`*`)
    expect(wrapped?.headers.get(`access-control-allow-methods`)).toContain(
      `GET`
    )
    const allowedHeaders = wrapped?.headers.get(`access-control-allow-headers`)
    expect(allowedHeaders).toContain(`electric-principal`)
    expect(allowedHeaders).toContain(`producer-id`)
    expect(allowedHeaders).toContain(`producer-epoch`)
    expect(allowedHeaders).toContain(`producer-seq`)
    expect(allowedHeaders).toContain(`stream-closed`)
  })

  it(`errorMapper converts ElectricAgentsError to API error JSON`, async () => {
    const response = errorMapper(
      new ElectricAgentsError(`TEST_CODE`, `boom`, 422, { foo: 1 }),
      new Request(`http://x`) as IRequest
    )
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: `TEST_CODE`, message: `boom`, details: { foo: 1 } },
    })
  })

  it(`errorMapper converts ElectricProxyError to its API error status`, async () => {
    const response = errorMapper(
      new ElectricProxyError(
        `TABLE_NOT_ALLOWED`,
        `Table is not available through the Electric proxy`,
        403
      ),
      new Request(`http://x`) as IRequest
    )
    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe(`TABLE_NOT_ALLOWED`)
  })

  it(`errorMapper maps an INVALID_WHERE ElectricProxyError to a 400`, async () => {
    const response = errorMapper(
      new ElectricProxyError(`INVALID_WHERE`, `Invalid where clause`, 400),
      new Request(`http://x`) as IRequest
    )
    expect(response.status).toBe(400)
    expect((await response.json()).error.code).toBe(`INVALID_WHERE`)
  })

  it(`errorMapper logs a warning for ElectricProxyError rejections`, () => {
    const warnSpy = vi.spyOn(serverLog, `warn`).mockImplementation(() => {})
    try {
      errorMapper(
        new ElectricProxyError(`TABLE_NOT_ALLOWED`, `nope`, 403),
        new Request(
          `http://x/_electric/electric/v1/shape?table=secrets`
        ) as IRequest
      )
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0]?.join(` `)).toContain(`TABLE_NOT_ALLOWED`)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it(`errorMapper turns unknown errors into a 500`, async () => {
    const response = errorMapper(
      new Error(`oops`),
      new Request(`http://x`) as IRequest
    )
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe(`INTERNAL_SERVER_ERROR`)
  })

  it(`rejectIfShuttingDown only blocks subscription-webhook paths`, () => {
    const ctx = buildCtx({ isShuttingDown: () => true })
    const blocked = rejectIfShuttingDown(
      new Request(`http://x/_electric/subscription-webhooks/abc`) as IRequest,
      ctx
    )
    expect(blocked?.status).toBe(503)

    const ignored = rejectIfShuttingDown(
      new Request(`http://x/_electric/entities/chat/test`) as IRequest,
      ctx
    )
    expect(ignored).toBeUndefined()

    const notShuttingDown = rejectIfShuttingDown(
      new Request(`http://x/_electric/subscription-webhooks/abc`) as IRequest,
      buildCtx()
    )
    expect(notShuttingDown).toBeUndefined()
  })

  it(`otel hooks compose in an itty-router hook chain`, async () => {
    const router = AutoRouter<IRequest, [TenantContext]>({
      before: [otelStartSpan],
      finally: [otelEndSpan],
    }).get(`/x`, () => new Response(`ok`))

    const response = await router.fetch(new Request(`http://x/x`), buildCtx())
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(`ok`)
  })
})
