import { describe, expect, it } from 'vitest'
import {
  deriveEntitiesObserveTags,
  deriveSharedStateId,
  resolveEntityMainStreamTarget,
  resolveObserveTarget,
} from './targets'

describe(`agents proxy target resolver`, () => {
  it(`maps a valid wiki-space entity to an encoded metadata path`, () => {
    const target = resolveEntityMainStreamTarget({
      wikiSpaceId: `wiki_demo-123`,
      entityKind: `wiki-space`,
      entityId: `space_1`,
    })

    expect(target).toEqual({
      kind: `entity-main-stream-via-metadata`,
      entityType: `wiki-space`,
      instanceId: `space_1`,
      metadataPath: `/_electric/entities/wiki-space/space_1`,
    })
  })

  it(`encodes all entity metadata path segments`, () => {
    const target = resolveEntityMainStreamTarget({
      wikiSpaceId: `wiki_demo`,
      entityKind: `wiki-space`,
      entityId: `space_1`,
    })

    expect(target.metadataPath).toBe(
      `/_electric/entities/${encodeURIComponent(`wiki-space`)}/${encodeURIComponent(`space_1`)}`
    )
    expect(target.metadataPath).not.toContain(`/_electric/entities//`)
  })

  it(`maps entities observe to ensure path and server-derived tags only`, () => {
    const target = resolveObserveTarget({
      wikiSpaceId: `wiki_demo`,
      observeKind: `entities`,
    })

    expect(target).toEqual({
      kind: `entities-observe-via-ensure`,
      ensurePath: `/_electric/observations/entities/ensure-stream`,
      ensureBody: { tags: { wiki_space_id: `wiki_demo` } },
    })
  })

  it(`maps shared-state observe to deterministic encoded stream path`, () => {
    const target = resolveObserveTarget({
      wikiSpaceId: `wiki_demo`,
      observeKind: `shared-state`,
    })

    expect(target).toEqual({
      kind: `shared-state-observe`,
      sharedStateId: `living-wiki:wiki_demo`,
      streamPath: `/_electric/shared-state/living-wiki%3Awiki_demo`,
    })
  })

  it(`exports stable server-side derivation helpers`, () => {
    expect(deriveEntitiesObserveTags(`wiki_demo`)).toEqual({
      wiki_space_id: `wiki_demo`,
    })
    expect(deriveSharedStateId(`wiki_demo`)).toBe(`living-wiki:wiki_demo`)
    expect(
      resolveObserveTarget({
        wikiSpaceId: `wiki_demo`,
        observeKind: `shared-state`,
      })
    ).toEqual(
      resolveObserveTarget({
        wikiSpaceId: `wiki_demo`,
        observeKind: `shared-state`,
      })
    )
  })

  it.each([
    [
      `raw entityUrl override`,
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
        entityUrl: `/_electric/entities/evil/raw`,
      },
    ],
    [
      `raw streamPath override`,
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
        streamPath: `/evil/main`,
      },
    ],
    [
      `unknown entity kind`,
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `orchestrator`,
        entityId: `wiki_demo`,
      },
    ],
    [
      `slash entity id`,
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki/demo`,
      },
    ],
    [
      `encoded slash entity id`,
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `wiki%2Fdemo`,
      },
    ],
    [
      `path traversal entity id`,
      { wikiSpaceId: `wiki_demo`, entityKind: `wiki-space`, entityId: `..` },
    ],
    [
      `malformed wiki space id`,
      {
        wikiSpaceId: `wiki demo`,
        entityKind: `wiki-space`,
        entityId: `wiki_demo`,
      },
    ],
  ])(`rejects invalid entity input: %s`, (_name, input) => {
    expect(() => resolveEntityMainStreamTarget(input)).toThrow()
  })

  it.each([
    [
      `tags override`,
      {
        wikiSpaceId: `wiki_demo`,
        observeKind: `entities`,
        tags: { wiki_space_id: `evil` },
      },
    ],
    [
      `shared-state id override`,
      {
        wikiSpaceId: `wiki_demo`,
        observeKind: `shared-state`,
        sharedStateId: `evil`,
      },
    ],
    [
      `source override`,
      {
        wikiSpaceId: `wiki_demo`,
        observeKind: `entities`,
        source: `evil-source`,
      },
    ],
    [
      `path override`,
      {
        wikiSpaceId: `wiki_demo`,
        observeKind: `shared-state`,
        path: `/_electric/shared-state/evil`,
      },
    ],
    [`unknown observe kind`, { wikiSpaceId: `wiki_demo`, observeKind: `cron` }],
    [
      `slash wiki space id`,
      { wikiSpaceId: `wiki/demo`, observeKind: `entities` },
    ],
    [
      `encoded slash wiki space id`,
      { wikiSpaceId: `wiki%2fdemo`, observeKind: `entities` },
    ],
    [
      `path traversal wiki space id`,
      { wikiSpaceId: `wiki..demo`, observeKind: `shared-state` },
    ],
  ])(`rejects invalid observe input: %s`, (_name, input) => {
    expect(() => resolveObserveTarget(input)).toThrow()
  })
})
