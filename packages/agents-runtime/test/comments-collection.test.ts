import { describe, it, expect } from 'vitest'
import { commentSchema, commentsCollection } from '../src/comments-collection'

describe(`commentsCollection`, () => {
  it(`parses a valid comment with a timeline reply_to target`, () => {
    const result = commentSchema.parse({
      key: `c-1`,
      body: `LGTM`,
      timestamp: `2024-01-01T00:00:00Z`,
      reply_to: {
        kind: `timeline`,
        collection: `run`,
        key: `run-42`,
        run_id: `run-42`,
      },
    })
    expect(result.body).toBe(`LGTM`)
    expect(result.reply_to).toMatchObject({
      kind: `timeline`,
      collection: `run`,
    })
  })

  it(`is externally writable and declares the comments contract`, () => {
    expect(commentsCollection.externallyWritable).toBe(true)
    expect(commentsCollection.contract).toBe(`comments/v1`)
  })
})
