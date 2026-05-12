import { describe, expect, it } from 'vitest'
import { AutoRouter } from 'itty-router'
import { ElectricAgentsError } from '../src/entity-manager'
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

  it(`errorMapper turns unknown errors into a 500`, async () => {
    const response = errorMapper(
      new Error(`oops`),
      new Request(`http://x`) as IRequest
    )
    expect(response.status).toBe(500)
    expect((await response.json()).error.code).toBe(`INTERNAL_SERVER_ERROR`)
  })

  it(`rejectIfShuttingDown only blocks webhook-forward paths`, () => {
    const ctx = buildCtx({ isShuttingDown: () => true })
    const blocked = rejectIfShuttingDown(
      new Request(`http://x/_electric/webhook-forward/abc`) as IRequest,
      ctx
    )
    expect(blocked?.status).toBe(503)

    const ignored = rejectIfShuttingDown(
      new Request(`http://x/_electric/entities/chat/test`) as IRequest,
      ctx
    )
    expect(ignored).toBeUndefined()

    const notShuttingDown = rejectIfShuttingDown(
      new Request(`http://x/_electric/webhook-forward/abc`) as IRequest,
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
