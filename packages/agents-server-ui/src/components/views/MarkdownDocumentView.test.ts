import { describe, expect, it } from 'vitest'
import { markdownDocumentConnectionConfig } from './MarkdownDocumentView'
import type { ManifestDocumentEntry } from '@electric-ax/agents-runtime/client'

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
