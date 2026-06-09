import { describe, expect, it } from 'vitest'
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import { coalesce } from '@durable-streams/state/db'
import { createEntityTimelineQuery } from '../src/entity-timeline'

let nextOffset = 1
function offset(): { offset: string; subOffset: number } {
  return {
    offset: `0000000000000000_${(nextOffset++).toString().padStart(16, `0`)}`,
    subOffset: 1,
  }
}

/**
 * Minimal sync collection that exposes raw sync hooks the same way StreamDB
 * does. The timeline query reacts to these collections, so registering a
 * custom collection here is the closest end-to-end check that the
 * `customSource` plumbing lands rows in the unioned, ordered timeline.
 */
function createSyncCollection<
  T extends Record<string, unknown> & { key: string },
>(id: string) {
  let begin: () => void
  let write: (msg: { type: string; value: T }) => void
  let commit: () => void
  const collection = createCollection<T, string>({
    id,
    getKey: (item) => item.key,
    sync: {
      sync: (params: any) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return () => {}
      },
    },
    startSync: true,
    gcTime: 0,
  })
  return {
    collection,
    insert(value: T) {
      begin!()
      write!({ type: `insert`, value })
      commit!()
    },
  }
}

function emptyDbCollections() {
  const take = () => offset()
  return {
    runs: createSyncCollection<{ key: string; status: string }>(
      `runs-${take().offset}`
    ),
    texts: createSyncCollection<{
      key: string
      run_id: string
      status: string
    }>(`texts-${take().offset}`),
    textDeltas: createSyncCollection<{
      key: string
      text_id: string
      run_id: string
      delta: string
    }>(`textDeltas-${take().offset}`),
    toolCalls: createSyncCollection<{
      key: string
      tool_name: string
      status: string
    }>(`toolCalls-${take().offset}`),
    steps: createSyncCollection<{
      key: string
      run_id: string
      step_number: number
      status: string
    }>(`steps-${take().offset}`),
    errors: createSyncCollection<{
      key: string
      run_id: string
      error_code: string
      message: string
    }>(`errors-${take().offset}`),
    inbox: createSyncCollection<{
      key: string
      from: string
      payload: unknown
      timestamp: string
      status: string
      _timeline_order?: string
    }>(`inbox-${take().offset}`),
    wakes: createSyncCollection<{
      key: string
      timestamp: string
      source: string
      timeout: boolean
      changes: Array<unknown>
      _timeline_order?: string
    }>(`wakes-${take().offset}`),
    signals: createSyncCollection<{
      key: string
      signal: string
      status: string
      timestamp: string
      _timeline_order?: string
    }>(`signals-${take().offset}`),
    manifests: createSyncCollection<{
      key: string
      kind: string
      _timeline_order?: string
    }>(`manifests-${take().offset}`),
  }
}

describe(`createEntityTimelineQuery customSource`, () => {
  it(`interleaves custom collection rows with built-in rows by _timeline_order`, async () => {
    const syncs = emptyDbCollections()
    const comments = createSyncCollection<{
      key: string
      body: string
      from_principal: string
      timestamp: string
      _timeline_order?: string
    }>(`comments-test`)

    const db = {
      collections: {
        runs: syncs.runs.collection,
        texts: syncs.texts.collection,
        textDeltas: syncs.textDeltas.collection,
        toolCalls: syncs.toolCalls.collection,
        steps: syncs.steps.collection,
        errors: syncs.errors.collection,
        inbox: syncs.inbox.collection,
        wakes: syncs.wakes.collection,
        signals: syncs.signals.collection,
        manifests: syncs.manifests.collection,
      },
    } as any

    const liveQuery = createLiveQueryCollection({
      query: (q) =>
        createEntityTimelineQuery(db, {
          customSource: q
            .from({ comment: comments.collection })
            .select(({ comment }) => ({
              collection: `comment` as const,
              order: coalesce(comment._timeline_order, `~`),
              key: comment.key,
              value: comment,
            })) as any,
        })(q),
      startSync: true,
    })
    await liveQuery.preload()

    syncs.inbox.insert({
      key: `msg-1`,
      from: `user`,
      payload: `hi`,
      timestamp: `2026-04-15T18:00:00Z`,
      status: `processed`,
      _timeline_order: `010`,
    })
    comments.insert({
      key: `c-1`,
      body: `nice`,
      from_principal: `/principal/user%3Ame`,
      timestamp: `2026-04-15T18:01:00Z`,
      _timeline_order: `020`,
    })
    syncs.inbox.insert({
      key: `msg-2`,
      from: `user`,
      payload: `bye`,
      timestamp: `2026-04-15T18:02:00Z`,
      status: `processed`,
      _timeline_order: `030`,
    })

    await new Promise((resolve) => setTimeout(resolve, 80))

    const rows = Array.from(liveQuery.entries()).map(([, v]: any) => v)

    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ inbox: { key: `msg-1` } })
    expect(rows[1]).toMatchObject({
      custom: { collection: `comment`, key: `c-1`, value: { body: `nice` } },
    })
    expect(rows[2]).toMatchObject({ inbox: { key: `msg-2` } })
  })

  it(`omits the custom slot when no customSource is provided`, async () => {
    const syncs = emptyDbCollections()
    const db = {
      collections: {
        runs: syncs.runs.collection,
        texts: syncs.texts.collection,
        textDeltas: syncs.textDeltas.collection,
        toolCalls: syncs.toolCalls.collection,
        steps: syncs.steps.collection,
        errors: syncs.errors.collection,
        inbox: syncs.inbox.collection,
        wakes: syncs.wakes.collection,
        signals: syncs.signals.collection,
        manifests: syncs.manifests.collection,
      },
    } as any

    const liveQuery = createLiveQueryCollection({
      query: (q) => createEntityTimelineQuery(db)(q),
      startSync: true,
    })
    await liveQuery.preload()

    syncs.inbox.insert({
      key: `msg-1`,
      from: `user`,
      payload: `hi`,
      timestamp: `2026-04-15T18:00:00Z`,
      status: `processed`,
      _timeline_order: `010`,
    })
    await new Promise((resolve) => setTimeout(resolve, 80))

    const rows = Array.from(liveQuery.entries()).map(([, v]: any) => v)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ inbox: { key: `msg-1` } })
    expect(rows[0].custom).toBeUndefined()
  })
})
