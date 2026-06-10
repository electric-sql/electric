import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createEntityStreamDB } from '../src/entity-stream-db'

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
})
