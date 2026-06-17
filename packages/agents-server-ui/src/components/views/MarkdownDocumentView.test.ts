import { describe, expect, it } from 'vitest'
import * as encoding from 'lib0/encoding'
import {
  Awareness,
  encodeAwarenessUpdate,
  type Awareness as AwarenessType,
} from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  applyMarkdownAwarenessFrames,
  markdownDocumentConnectionConfig,
} from './MarkdownDocumentView'
import type { ManifestDocumentEntry } from '@electric-ax/agents-runtime/client'

function frame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

describe(`markdownDocumentConnectionConfig`, () => {
  it(`uses explicit provider doc metadata for editor connections`, () => {
    const config = markdownDocumentConnectionConfig(
      `http://localhost:4437/app`,
      {
        key: `document:notes`,
        kind: `document`,
        id: `notes`,
        provider: `y-durable-streams`,
        docId: `agents/chat/session/documents/notes`,
        docPath: `agents/chat/session/documents/notes`,
        streamPath: `/v1/yjs/default/docs/agents/chat/session/documents/notes`,
        transportMimeType: `application/vnd.electric-agents.markdown-yjs`,
        contentMimeType: `text/markdown`,
        yTextName: `markdown`,
        title: `Notes`,
        createdAt: `2026-01-01T00:00:00.000Z`,
      } as ManifestDocumentEntry
    )

    expect(config).toMatchObject({
      providerUrl: `http://localhost:4437/app/v1/yjs/default`,
      docId: `agents/chat/session/documents/notes`,
      yTextName: `markdown`,
    })
    expect(config.docUrl.toString()).toBe(
      `http://localhost:4437/app/v1/yjs/default/docs/agents/chat/session/documents/notes`
    )
  })
})

describe(`applyMarkdownAwarenessFrames`, () => {
  it(`applies lib0-framed awareness updates`, () => {
    const sourceDoc = new Y.Doc()
    const source = new Awareness(sourceDoc)
    source.setLocalState({
      user: { name: `horton`, role: `agent`, status: `editing` },
      cursor: { anchor: 4, head: 4 },
    })

    const target = new Awareness(new Y.Doc()) as AwarenessType
    applyMarkdownAwarenessFrames(
      target,
      frame(encodeAwarenessUpdate(source, [source.clientID]))
    )

    const remoteState = target.getStates().get(source.clientID)
    expect(remoteState).toMatchObject({
      user: { name: `horton`, role: `agent`, status: `editing` },
      cursor: { anchor: 4, head: 4 },
    })
  })
})
