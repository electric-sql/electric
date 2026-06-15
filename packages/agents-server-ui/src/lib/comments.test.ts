import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection, localOnlyCollectionOptions } from '@tanstack/db'
import { compareTimelineOrders } from '@electric-ax/agents-runtime/client'
import { createLiveQueryCollection } from '@durable-streams/state/db'
import { registerActiveServerHeaders } from './auth-fetch'
import {
  buildCommentsTimeline,
  commentFocusViewParams,
  createCommentsTimelineSource,
  createSendCommentAction,
  decodeCommentTargetParam,
} from './comments'
import type {
  CommentSnapshot,
  CommentTarget,
  EntityStreamDBWithActions,
} from '@electric-ax/agents-runtime/client'
import type { OptimisticComment, TimelineRow } from './comments'

function createCommentsDb() {
  const comments = createCollection(
    localOnlyCollectionOptions({
      id: `test-comments-${Math.random().toString(36).slice(2)}`,
      getKey: (comment: OptimisticComment) => comment.key,
    })
  )
  return {
    db: {
      collections: {
        comments,
      },
    } as unknown as EntityStreamDBWithActions,
    comments,
  }
}

describe(`createCommentsTimelineSource`, () => {
  it(`projects author from _principal, falling back to the optimistic from`, async () => {
    const { db, comments } = createCommentsDb()
    const liveQuery = createLiveQueryCollection({
      query: createCommentsTimelineSource(db),
      startSync: true,
    })
    await liveQuery.preload()

    comments.insert({
      key: `c-synced`,
      _timeline_order: `00000002`,
      body: `hello`,
      timestamp: `2026-04-15T18:00:00.000Z`,
      _principal: { url: `/principal/user%3Ajane`, kind: `user`, id: `jane` },
    } as any)
    comments.insert({
      key: `c-optimistic`,
      _timeline_order: `~pending:000000000001`,
      body: `mine`,
      from: `/principal/user%3Ame`,
    } as any)
    await new Promise((r) => setTimeout(r, 50))

    const rows = new Map(liveQuery.toArray.map((row: any) => [row.key, row]))
    expect(rows.get(`c-synced`)).toMatchObject({
      order: `00000002`,
      body: `hello`,
      from: `/principal/user%3Ajane`,
    })
    expect(rows.get(`c-optimistic`)).toMatchObject({
      from: `/principal/user%3Ame`,
    })
  })
})

describe(`createSendCommentAction`, () => {
  afterEach(() => {
    vi.restoreAllMocks()
    registerActiveServerHeaders(null)
  })

  it(`inserts optimistic comments at increasing pending timeline orders`, async () => {
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`{}`, { status: 201 }))
    const { db } = createCommentsDb()
    const optimistic: Array<OptimisticComment> = []
    const sendComment = createSendCommentAction({
      db,
      baseUrl: `http://localhost:4437`,
      entityUrl: `/chat/test`,
      from: `/principal/user%3Ame`,
      onOptimisticComment: (comment) => optimistic.push(comment),
    })

    const firstTx = sendComment({ body: `first` })
    const secondTx = sendComment({ body: `second` })
    await Promise.all([
      firstTx.isPersisted.promise,
      secondTx.isPersisted.promise,
    ])

    expect(optimistic).toHaveLength(2)
    expect(optimistic[0]?._principal?.url).toBe(`/principal/user%3Ame`)
    expect(optimistic[0]?._timeline_order).toMatch(/^~pending:/)
    expect(optimistic[1]?._timeline_order).toMatch(/^~pending:/)
    expect(
      compareTimelineOrders(
        optimistic[0]!._timeline_order,
        optimistic[1]!._timeline_order
      )
    ).toBeLessThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it(`posts reply metadata with the same key as the optimistic row`, async () => {
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockResolvedValue(new Response(`{}`, { status: 201 }))
    const { db } = createCommentsDb()
    const optimistic: Array<OptimisticComment> = []
    const replyTo: CommentTarget = {
      kind: `timeline`,
      collection: `run`,
      key: `run-1`,
    }
    const targetSnapshot: CommentSnapshot = {
      label: `Assistant response`,
      text: `Draft reply`,
      collection: `run`,
    }
    const sendComment = createSendCommentAction({
      db,
      baseUrl: `http://localhost:4437`,
      entityUrl: `/chat/test`,
      from: `/principal/user%3Ame`,
      onOptimisticComment: (comment) => optimistic.push(comment),
    })

    const tx = sendComment({
      body: `looks right`,
      replyTo,
      targetSnapshot,
    })
    await tx.isPersisted.promise

    expect(optimistic).toHaveLength(1)
    expect(optimistic[0]).toMatchObject({
      body: `looks right`,
      from: `/principal/user%3Ame`,
      reply_to: replyTo,
      target_snapshot: targetSnapshot,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(
      `http://localhost:4437/_electric/entities/chat/test/collections/comments`
    )
    expect(init?.method).toBe(`POST`)
    expect(new Headers(init?.headers).get(`content-type`)).toBe(
      `application/json`
    )
    const parsed = JSON.parse(String(init?.body))
    expect(parsed.operation).toBe(`insert`)
    expect(parsed.key).toBe(optimistic[0]!.key)
    expect(parsed.value).toMatchObject({
      body: `looks right`,
      reply_to: replyTo,
      target_snapshot: targetSnapshot,
    })
    expect(parsed.value).not.toHaveProperty(`from_principal`)
  })

  it(`rejects the persistence promise when the server rejects the comment`, async () => {
    vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ message: `No write access` }), {
        status: 403,
      })
    )
    const { db } = createCommentsDb()
    const sendComment = createSendCommentAction({
      db,
      baseUrl: `http://localhost:4437`,
      entityUrl: `/chat/test`,
    })

    const tx = sendComment({ body: `blocked` })

    await expect(tx.isPersisted.promise).rejects.toThrow(`No write access`)
  })
})

function commentRow(
  key: string,
  fromPrincipal = `/principal/user%3Ame`
): TimelineRow {
  return {
    $key: `comment:${key}`,
    comment: {
      key,
      order: key,
      body: key,
      from: fromPrincipal,
      timestamp: `2026-04-15T18:00:00.000Z`,
    },
  } as TimelineRow
}

function wakeRow(key: string): TimelineRow {
  return {
    $key: `wake:${key}`,
    wake: {
      key,
      order: key,
      payload: {
        type: `wake`,
        timestamp: `2026-04-15T18:00:00.000Z`,
        source: `/chat/test`,
        timeout: false,
        changes: [],
      },
    },
  } as TimelineRow
}

function attachmentRow(key: string): TimelineRow {
  return {
    $key: `manifest:${key}`,
    manifest: {
      key,
      kind: `attachment`,
      id: key,
      streamPath: `/chat/test/attachments/${key}`,
      status: `complete`,
      subject: { type: `inbox`, key: `msg-1` },
      mimeType: `text/plain`,
      byteLength: 12,
      createdAt: `2026-04-15T18:00:00.000Z`,
    },
  } as TimelineRow
}

describe(`buildCommentsTimeline`, () => {
  it(`keeps comments in stream order while using full-timeline adjacency`, () => {
    const first = commentRow(`first`)
    const wake = wakeRow(`wake-1`)
    const second = commentRow(`second`)
    const third = commentRow(`third`)
    const attachment = attachmentRow(`att-1`)
    const fourth = commentRow(`fourth`)

    const timeline = buildCommentsTimeline([
      first,
      wake,
      second,
      third,
      attachment,
      fourth,
    ])

    expect(timeline.rows.map((row) => row.comment?.key)).toEqual([
      `first`,
      `second`,
      `third`,
      `fourth`,
    ])
    expect(timeline.adjacency[0]).toEqual({
      previousRow: undefined,
      nextRow: wake,
    })
    expect(timeline.adjacency[1]).toEqual({
      previousRow: wake,
      nextRow: third,
    })
    expect(timeline.adjacency[2]).toEqual({
      previousRow: second,
      nextRow: fourth,
    })
    expect(timeline.adjacency[3]).toEqual({
      previousRow: third,
    })
  })
})

describe(`comment focus view params`, () => {
  it(`round-trips timeline targets for comments-view navigation`, () => {
    const target: CommentTarget = {
      kind: `timeline`,
      collection: `tool_call`,
      key: `tool-call-1`,
      run_id: `run-1`,
    }

    const params = commentFocusViewParams(target)

    expect(decodeCommentTargetParam(params.focus)).toEqual(target)
  })

  it(`rejects invalid encoded target collections`, () => {
    const encoded = encodeURIComponent(
      JSON.stringify({
        kind: `timeline`,
        collection: `unknown`,
        key: `thing-1`,
      })
    )

    expect(decodeCommentTargetParam(encoded)).toBeNull()
  })
})
