import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { z } from 'zod'
import { defineInboxHandlers } from '../src/helpers'
import type { HandlerContext, WakeEvent } from '../src/types'

const ctx = {} as HandlerContext

function wake(overrides: Partial<WakeEvent> = {}): WakeEvent {
  return {
    source: `entity://test`,
    type: `inbox`,
    summary: `continueStep`,
    fromOffset: 1,
    toOffset: 1,
    eventCount: 1,
    payload: { step: 2 },
    ...overrides,
  }
}

describe(`defineInboxHandlers`, () => {
  it(`dispatches inbox messages with validated typed payloads`, async () => {
    const handler = vi.fn()
    const router = defineInboxHandlers(
      { continueStep: z.object({ step: z.number() }) },
      {
        async continueStep(_ctx, event) {
          expectTypeOf(event.type).toEqualTypeOf<`continueStep`>()
          expectTypeOf(event.payload.step).toEqualTypeOf<number>()
          handler(event)
        },
      }
    )

    await expect(router.handle(ctx, wake())).resolves.toBe(true)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: `inbox`,
        type: `continueStep`,
        payload: { step: 2 },
        rawPayload: { step: 2 },
      })
    )
  })

  it(`falls through for non-inbox, unknown, missing, or unhandled messages`, async () => {
    const router = defineInboxHandlers(
      {
        continueStep: z.object({ step: z.number() }),
        cancelJob: z.object({ reason: z.string() }),
      },
      { continueStep: vi.fn() }
    )

    await expect(router.handle(ctx, wake({ type: `cron` }))).resolves.toBe(
      false
    )
    await expect(
      router.handle(ctx, wake({ summary: undefined }))
    ).resolves.toBe(false)
    await expect(
      router.handle(ctx, wake({ summary: `unknown` }))
    ).resolves.toBe(false)
    await expect(
      router.handle(ctx, wake({ summary: `cancelJob` }))
    ).resolves.toBe(false)
  })

  it(`throws when the payload does not match the schema`, async () => {
    const router = defineInboxHandlers(
      { continueStep: z.object({ step: z.number() }) },
      { continueStep: vi.fn() }
    )

    await expect(
      router.handle(ctx, wake({ payload: { step: `two` } }))
    ).rejects.toThrow(`Invalid inbox payload for "continueStep"`)
  })
})
