import { describe, expect, it } from 'vitest'
import {
  buildCommentsTimeline,
  commentFocusViewParams,
  decodeCommentTargetParam,
} from './ChatView'
import type { CommentTarget } from '@electric-ax/agents-runtime/client'
import type { TimelineRow } from '../../lib/comments'

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
