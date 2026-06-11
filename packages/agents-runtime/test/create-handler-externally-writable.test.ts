import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { buildEntityTypeRegistrationBody } from '../src/create-handler'

describe(`buildEntityTypeRegistrationBody`, () => {
  it(`emits externally_writable_collections for externally writable state collections only`, () => {
    const body = buildEntityTypeRegistrationBody(`chat`, {
      description: `chat`,
      handler: async () => {},
      state: {
        comments: {
          schema: z.object({ key: z.string().optional(), body: z.string() }),
          externallyWritable: true,
        },
        scratch: {
          schema: z.object({ key: z.string().optional(), note: z.string() }),
        },
      },
    } as any)
    expect(body.externally_writable_collections).toEqual({
      comments: { type: `state:comments` },
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
