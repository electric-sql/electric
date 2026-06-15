import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  COMMENTS_CONTRACT,
  commentsCollection,
} from '../src/comments-collection'
import { buildEntityTypeRegistrationBody } from '../src/create-handler'

describe(`buildEntityTypeRegistrationBody`, () => {
  it(`emits externally_writable_collections for externally writable state collections only`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: {
        feedback: {
          schema: z.object({ key: z.string().optional(), body: z.string() }),
          externallyWritable: true,
        },
        scratch: {
          schema: z.object({ key: z.string().optional(), note: z.string() }),
        },
      },
    } as any)
    expect(body.externally_writable_collections).toEqual({
      feedback: { type: `state:feedback` },
    })
  })

  it(`forwards the collection contract when declared`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: { comments: commentsCollection },
    } as any)
    expect(body.externally_writable_collections).toEqual({
      comments: {
        type: `state:comments`,
        contract: COMMENTS_CONTRACT,
        operations: [`insert`],
      },
    })
  })

  it(`omits externally_writable_collections when no collection opts in`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: { scratch: { schema: z.object({ note: z.string() }) } },
    } as any)
    expect(body.externally_writable_collections).toBeUndefined()
  })
})
