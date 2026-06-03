import { describe, expect, it } from 'vitest'
import {
  agentsEntityTargetInputSchema,
  agentsObserveTargetInputSchema,
} from './agents-proxy'

describe(`agents proxy target schemas`, () => {
  it(`accepts a valid entity target`, () => {
    expect(
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo-123`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo-123`,
      })
    ).toEqual({
      wikiSpaceId: `wiki_demo-123`,
      entityKind: `wiki-space`,
      entityId: `wiki_demo-123`,
    })
  })

  it.each([`entities`, `shared-state`] as const)(
    `accepts a valid %s observe target`,
    (observeKind) => {
      expect(
        agentsObserveTargetInputSchema.parse({
          wikiSpaceId: `wiki_demo-123`,
          observeKind,
        })
      ).toEqual({ wikiSpaceId: `wiki_demo-123`, observeKind })
    }
  )

  it.each([
    [`slash`, `wiki/demo`],
    [`encoded slash uppercase`, `wiki%2Fdemo`],
    [`encoded slash lowercase`, `wiki%2fdemo`],
    [`path traversal`, `wiki..demo`],
    [`space`, `wiki demo`],
    [`empty`, ``],
  ])(`rejects unsafe ids with %s`, (_caseName, id) => {
    expect(() =>
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: id,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
      })
    ).toThrow()

    expect(() =>
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: id,
      })
    ).toThrow()

    expect(() =>
      agentsObserveTargetInputSchema.parse({
        wikiSpaceId: id,
        observeKind: `entities`,
      })
    ).toThrow()
  })

  it(`rejects unknown entity kinds`, () => {
    expect(() =>
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        entityKind: `orchestrator`,
        entityId: `wiki_demo`,
      })
    ).toThrow()
  })

  it(`rejects unknown observe kinds`, () => {
    expect(() =>
      agentsObserveTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        observeKind: `cron`,
      })
    ).toThrow()
  })

  it(`rejects raw upstream fields on entity targets`, () => {
    expect(() =>
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
        entityUrl: `/_electric/entities/wiki-space/wiki_demo`,
      })
    ).toThrow()

    expect(() =>
      agentsEntityTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
        upstreamPath: `/_electric/entities/wiki-space/wiki_demo`,
      })
    ).toThrow()
  })

  it(`rejects raw upstream fields on observe targets`, () => {
    expect(() =>
      agentsObserveTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        observeKind: `entities`,
        path: `/_electric/observations/entities/ensure-stream`,
      })
    ).toThrow()

    expect(() =>
      agentsObserveTargetInputSchema.parse({
        wikiSpaceId: `wiki_demo`,
        observeKind: `shared-state`,
        upstreamUrl: `https://runtime.example/_electric/shared-state/wiki_demo`,
      })
    ).toThrow()
  })
})
