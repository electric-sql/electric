import { describe, expect, it } from 'vitest'
import { createContextTools } from '../src/tools/context-tools'
import type { ContextToolsContext } from '../src/tools/context-tools'

function makeCtx(): ContextToolsContext {
  return {
    loadTimelineRange: ({ from, to }) =>
      Promise.resolve(`timeline ${from}..${to}`),
    loadSourceRange: ({ name, from, to, snapshot }) =>
      Promise.resolve(`source ${name} ${from}..${to} @ ${snapshot}`),
    loadContextHistory: ({ id, offset }) =>
      Promise.resolve(`history ${id} @ ${offset}`),
  }
}

function firstText(result: {
  content?: Array<{ type?: string; text?: string }>
}) {
  const first = result.content?.[0]
  return first && first.type === `text` ? first.text : ``
}

describe(`context tools`, () => {
  it(`load_timeline_range returns the expected payload`, async () => {
    const tool = createContextTools(makeCtx()).find(
      (candidate) => candidate.name === `load_timeline_range`
    )!
    const result = (await tool.execute(`tc-1`, { from: 1, to: 10 })) as any
    expect(firstText(result)).toContain(`1..10`)
  })

  it(`load_source_range uses the snapshot id`, async () => {
    const tool = createContextTools(makeCtx()).find(
      (candidate) => candidate.name === `load_source_range`
    )!
    const result = (await tool.execute(`tc-1`, {
      name: `skill`,
      from: 0,
      to: 4,
      snapshot: `abc`,
    })) as any
    expect(firstText(result)).toContain(`skill 0..4 @ abc`)
  })

  it(`load_context_history returns the tombstoned value`, async () => {
    const tool = createContextTools(makeCtx()).find(
      (candidate) => candidate.name === `load_context_history`
    )!
    const result = (await tool.execute(`tc-1`, {
      id: `search:a`,
      offset: `0000000000000010_0000000000000100`,
    })) as any
    expect(firstText(result)).toContain(
      `search:a @ 0000000000000010_0000000000000100`
    )
  })

  it(`load_source_range rejects when the snapshot is missing`, async () => {
    const tool = createContextTools({
      ...makeCtx(),
      loadSourceRange: () =>
        Promise.reject(new Error(`[missing snapshot abc]`)),
    }).find((candidate) => candidate.name === `load_source_range`)!

    await expect(
      tool.execute(`tc-1`, {
        name: `skill`,
        from: 0,
        to: 4,
        snapshot: `abc`,
      })
    ).rejects.toThrow(`[missing snapshot abc]`)
  })

  it(`load_context_history rejects when the history row is missing`, async () => {
    const tool = createContextTools({
      ...makeCtx(),
      loadContextHistory: () =>
        Promise.reject(
          new Error(`[missing context history for search:a @ missing-offset]`)
        ),
    }).find((candidate) => candidate.name === `load_context_history`)!

    await expect(
      tool.execute(`tc-1`, {
        id: `search:a`,
        offset: `missing-offset`,
      })
    ).rejects.toThrow(`[missing context history for search:a @ missing-offset]`)
  })
})
