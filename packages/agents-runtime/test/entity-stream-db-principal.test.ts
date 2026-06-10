import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createEntityStreamDB } from '../src/entity-stream-db'
import type { ChangeEvent } from '@durable-streams/state'

function principalHeader() {
  return { url: `/principal/user%3Aalice`, kind: `user`, id: `alice` }
}

describe(`entity-stream-db principal virtual column`, () => {
  it(`projects headers.principal onto the configured column for writable collections`, () => {
    const db = createEntityStreamDB(`/chat/sess-1`, {
      comments: {
        schema: z.object({ key: z.string().optional(), body: z.string() }),
        writable: { principalColumn: `_principal` },
      },
    })
    db.utils.applyEvent({
      type: `state:comments`,
      key: `c1`,
      headers: { operation: `insert`, principal: principalHeader() },
      value: { body: `hi` },
    } as any)
    const row = db.collections.comments.get(`c1`) as Record<string, unknown>
    expect(row.body).toBe(`hi`)
    expect(row._principal).toEqual(principalHeader())
  })

  it(`projects headers.principal onto _principal when writable: true`, () => {
    const db = createEntityStreamDB(`/chat/sess-3`, {
      notes: {
        schema: z.object({ key: z.string().optional(), body: z.string() }),
        writable: true,
      },
    })
    db.utils.applyEvent({
      type: `state:notes`,
      key: `n2`,
      headers: { operation: `insert`, principal: principalHeader() },
      value: { body: `hello` },
    } as any)
    const row = db.collections.notes.get(`n2`) as Record<string, unknown>
    expect(row._principal).toEqual(principalHeader())
  })

  it(`does not add a principal column when the collection is not writable`, () => {
    const db = createEntityStreamDB(`/chat/sess-2`, {
      notes: {
        schema: z.object({ key: z.string().optional(), body: z.string() }),
      },
    })
    db.utils.applyEvent({
      type: `state:notes`,
      key: `n1`,
      headers: { operation: `insert`, principal: principalHeader() },
      value: { body: `hi` },
    } as any)
    const row = db.collections.notes.get(`n1`) as Record<string, unknown>
    expect(row._principal).toBeUndefined()
  })

  it(`strips the principal column from outgoing ChangeEvent value on insert`, async () => {
    const captured: Array<ChangeEvent> = []
    let awaitTxIdResolve: (() => void) | undefined
    const db = createEntityStreamDB(
      `/chat/sess-4`,
      {
        comments: {
          schema: z.object({ key: z.string().optional(), body: z.string() }),
          writable: { principalColumn: `_principal` },
        },
      },
      undefined,
      {
        writeEvent: (ev) => captured.push(ev),
        flushWrites: async () => {},
      }
    )

    // Stub awaitTxId so the action's mutationFn resolves immediately
    ;(db.utils as any).awaitTxId = (_txid: string) =>
      new Promise<void>((r) => {
        awaitTxIdResolve = r
      })

    // Trigger an insert that carries a _principal field (simulating a row
    // materialized with the principal virtual column writing back to the server)
    const actionPromise = (db.actions as any).comments_insert({
      row: { key: `c1`, body: `hello`, _principal: principalHeader() },
    })

    // writeEvent is called synchronously inside persistMutationsNow before
    // flushWrites resolves, so captured should be populated already
    await Promise.resolve()

    expect(captured).toHaveLength(1)
    const ev = captured[0]! as ChangeEvent & { value: Record<string, unknown> }
    expect(ev.value._principal).toBeUndefined()
    expect(ev.value._seq).toBeUndefined()
    expect(ev.value._timeline_order).toBeUndefined()
    expect(ev.value.body).toBe(`hello`)

    // Resolve the awaitTxId so the action promise doesn't hang
    awaitTxIdResolve?.()
    await actionPromise
  })
})
