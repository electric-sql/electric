import { describe, expect, it } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`assembleContext cache tiers`, () => {
  it(`orders pinned -> stable -> slow-changing -> volatile`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10_000,
      sources: {
        v: { content: () => `VOL`, max: 100, cache: `volatile` },
        s: { content: () => `STB`, max: 100, cache: `stable` },
        p: { content: () => `PIN`, max: 100, cache: `pinned` },
        sc: { content: () => `SLC`, max: 100, cache: `slow-changing` },
      },
    })

    const contents = messages.map((message) => message.content).join(`|`)
    expect(contents.indexOf(`PIN`)).toBeLessThan(contents.indexOf(`STB`))
    expect(contents.indexOf(`STB`)).toBeLessThan(contents.indexOf(`SLC`))
    expect(contents.indexOf(`SLC`)).toBeLessThan(contents.indexOf(`VOL`))
  })
})
