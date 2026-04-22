import { describe, expect, it, vi } from 'vitest'
import { createContextEntriesApi } from '../src/context-entries'
import {
  buildStreamFixture,
  createFakeWakeSession,
  createTestHandlerContext,
} from './helpers/context-test-helpers'

describe(`context entries`, () => {
  it(`insert writes a durable event`, () => {
    const writeEvent = vi.fn()
    const { ctx } = createTestHandlerContext({ writeEvent })

    ctx.insertContext(`search:a`, {
      name: `search_results`,
      attrs: { query: `x`, hits: 3 },
      content: `body`,
    })

    expect(writeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: `context_inserted` })
    )
  })

  it(`remove on missing id is a silent no-op`, () => {
    const writeEvent = vi.fn()
    const { ctx } = createTestHandlerContext({ writeEvent })
    ctx.removeContext(`never-inserted`)
    expect(writeEvent).not.toHaveBeenCalled()
  })

  it(`re-inserting the same id leaves the prior value tombstoned`, () => {
    const writeEvent = vi.fn()
    const { ctx } = createTestHandlerContext({ writeEvent })
    ctx.insertContext(`k`, { name: `n`, content: `a` })
    ctx.insertContext(`k`, { name: `n`, content: `b` })
    expect(writeEvent).toHaveBeenCalledTimes(2)
  })

  it(`same-id same-millisecond reinserts still get distinct durable keys`, () => {
    const db = buildStreamFixture([])
    const writeEvent = vi.fn()
    const api = createContextEntriesApi({
      db,
      writeEvent,
      wakeSession: createFakeWakeSession(db),
      nextOffset: () => 123,
      now: () => `2026-04-15T00:00:00.000Z`,
    })

    api.insertContext(`note`, { name: `memo`, content: `v1` })
    api.insertContext(`note`, { name: `memo`, content: `v2` })

    expect(writeEvent).toHaveBeenCalledTimes(2)
    expect(writeEvent.mock.calls[0]?.[0]).toMatchObject({
      key: `context:note:123`,
    })
    expect(writeEvent.mock.calls[1]?.[0]).toMatchObject({
      key: `context:note:123_1`,
    })
  })

  it(`listContext returns live manifest entries only`, () => {
    const { ctx } = createTestHandlerContext({})
    ctx.insertContext(`entry-1`, { name: `memo`, content: `a` })
    ctx.insertContext(`entry-2`, { name: `memo`, content: `b` })
    ctx.removeContext(`entry-1`)
    expect(ctx.listContext()).toHaveLength(1)
    expect(ctx.listContext()[0]).toMatchObject({
      id: `entry-2`,
      name: `memo`,
      attrs: {},
      content: `b`,
    })
  })
})
