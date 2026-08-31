import { describe, expect, it, vi } from 'vitest'
import {
  createStreamAppendRouteRequest,
  electricAgentsStreamAppendRouter,
} from '../src/routing/stream-append'
import type { ElectricAgentsStreamAppendRuntime } from '../src/routing/stream-append'

const entity = {
  url: `/horton/demo`,
  type: `horton`,
  status: `idle`,
  streams: { main: `/horton/demo/main` },
  write_token: `claim-token-1`,
}

function buildRuntime(opts: {
  fencedSessionStreams: boolean
  hasEntity?: boolean
}): ElectricAgentsStreamAppendRuntime {
  return {
    manager: {
      registry: {
        getEntityByStream: vi
          .fn()
          .mockResolvedValue(opts.hasEntity === false ? null : entity),
      },
      fencedSessionStreams: opts.fencedSessionStreams,
      isAttachmentStreamPath: vi.fn(() => false),
      isValidWriteToken: vi.fn(() => true),
      isForkWriteLockedEntity: vi.fn(() => false),
      isForkWriteLockedStream: vi.fn(() => false),
      validateWriteEvent: vi.fn().mockResolvedValue(null),
    } as any,
    evaluateWakePayload: vi.fn().mockResolvedValue(undefined),
    checkRunFinished: vi.fn(),
    syncManifestWakes: vi.fn().mockResolvedValue(undefined),
    syncManifestEntitySources: vi.fn().mockResolvedValue(undefined),
    syncManifestSchedules: vi.fn().mockResolvedValue(undefined),
  }
}

function appendRequest(path: string) {
  return createStreamAppendRouteRequest(
    new Request(`http://agents.local${path}`, {
      method: `POST`,
      headers: {
        'content-type': `application/json`,
        authorization: `Bearer claim-token-1`,
      },
      body: JSON.stringify({ type: `default`, key: `k1`, value: {} }),
    })
  )
}

describe(`entity stream appends`, () => {
  it(`forwards the write token and fenced-class assertion when fenced session streams are enabled`, async () => {
    let forwardedHeaders: Headers | null = null
    const forward = vi.fn(async (req: { headers: Headers }) => {
      forwardedHeaders = req.headers
      return new Response(null, { status: 204 })
    })

    const response = await electricAgentsStreamAppendRouter.fetch(
      appendRequest(`/horton/demo/main`),
      buildRuntime({ fencedSessionStreams: true }),
      forward as any
    )

    expect(response?.status).toBe(204)
    expect(forwardedHeaders!.get(`Write-Token`)).toBe(`claim-token-1`)
    expect(forwardedHeaders!.get(`Write-Fence`)).toBe(`true`)
  })

  it(`forwards appends without fencing headers by default`, async () => {
    let forwardedHeaders: Headers | null = null
    const forward = vi.fn(async (req: { headers: Headers }) => {
      forwardedHeaders = req.headers
      return new Response(null, { status: 204 })
    })

    const response = await electricAgentsStreamAppendRouter.fetch(
      appendRequest(`/horton/demo/main`),
      buildRuntime({ fencedSessionStreams: false }),
      forward as any
    )

    expect(response?.status).toBe(204)
    expect(forwardedHeaders!.has(`Write-Token`)).toBe(false)
    expect(forwardedHeaders!.has(`Write-Fence`)).toBe(false)
  })

  it(`never asserts the fenced class on shared-state appends`, async () => {
    let forwardedHeaders: Headers | null = null
    const forward = vi.fn(async (req: { headers: Headers }) => {
      forwardedHeaders = req.headers
      return new Response(null, { status: 204 })
    })

    const response = await electricAgentsStreamAppendRouter.fetch(
      appendRequest(`/_electric/shared-state/board-1`),
      buildRuntime({ fencedSessionStreams: true, hasEntity: false }),
      forward as any
    )

    expect(response?.status).toBe(204)
    expect(forwardedHeaders!.has(`Write-Token`)).toBe(false)
    expect(forwardedHeaders!.has(`Write-Fence`)).toBe(false)
  })
})
