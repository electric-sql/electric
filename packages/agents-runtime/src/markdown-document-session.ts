import { YjsProvider } from '@durable-streams/y-durable-streams'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  MARKDOWN_DOCUMENT_AGENT_PRESENCE_TTL_MS,
  MARKDOWN_DOCUMENT_TEXT_NAME,
} from './markdown-document-constants'
import { markdownText } from './markdown-yjs'
import type {
  ManifestDocumentEntry,
  MarkdownDocumentConnection,
  RuntimePrincipal,
} from './types'

export type MarkdownDocumentPresence = {
  anchor?: number
  head?: number
  clear?: boolean
}

export type MarkdownDocumentSession = {
  readonly document: ManifestDocumentEntry
  readonly doc: Y.Doc
  readonly text: Y.Text
  readonly textName: string
  content: () => string
  setPresence: (opts: MarkdownDocumentPresence) => Promise<void>
  flush: () => Promise<void>
  close: () => Promise<void>
}

export async function openMarkdownDocumentSession(opts: {
  document: ManifestDocumentEntry
  connection: MarkdownDocumentConnection
  entityUrl: string
  principal?: RuntimePrincipal
}): Promise<MarkdownDocumentSession> {
  const doc = new Y.Doc()
  const textName = opts.document.yTextName || MARKDOWN_DOCUMENT_TEXT_NAME
  const text = markdownText(doc, textName)
  const awareness = new Awareness(doc)
  const provider = new YjsProvider({
    doc,
    baseUrl: opts.connection.baseUrl,
    docId: opts.connection.docId,
    awareness,
    headers: opts.connection.headers,
    liveMode: `sse`,
    connect: false,
  })
  const principalUrl = `/principal/entity:${encodeURIComponent(opts.entityUrl)}`
  const color = principalColor(principalUrl)

  await provider.connect()

  const content = (): string => text.toString()

  const setPresence = async ({
    anchor,
    head,
    clear,
  }: MarkdownDocumentPresence): Promise<void> => {
    if (clear) {
      awareness.setLocalState(null)
      await settleAwarenessUpdate()
      return
    }
    const boundedAnchor = boundIndex(anchor ?? text.length, text.length)
    const boundedHead = boundIndex(head ?? boundedAnchor, text.length)
    const now = Date.now()
    awareness.setLocalState({
      user: {
        name: principalDisplayName(principalUrl),
        principalUrl,
        role: principalRole(principalUrl),
        status: `editing`,
        updatedAt: now,
        expiresAt: now + MARKDOWN_DOCUMENT_AGENT_PRESENCE_TTL_MS,
        color: color.color,
        colorLight: color.colorLight,
      },
      cursor: {
        anchor: Y.createRelativePositionFromTypeIndex(text, boundedAnchor),
        head: Y.createRelativePositionFromTypeIndex(text, boundedHead),
      },
    })
    await settleAwarenessUpdate()
  }

  return {
    document: opts.document,
    doc,
    text,
    textName,
    content,
    setPresence,
    flush: () => provider.flush(),
    close: async () => {
      awareness.setLocalState(null)
      await settleAwarenessUpdate()
      await provider.flush()
      await provider.disconnect()
      awareness.destroy()
      provider.destroy()
      doc.destroy()
    },
  }
}

function boundIndex(value: number, length: number): number {
  return Math.max(0, Math.min(Math.floor(value), length))
}

function settleAwarenessUpdate(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function principalDisplayName(principalUrl: string): string {
  const raw = principalUrl.split(`/principal/`).at(-1) ?? principalUrl
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Keep the raw value when the URL segment is not URI encoded.
  }
  const withoutPrefix = decoded.replace(/^(user|agent|entity|system):/, ``)
  if (withoutPrefix.startsWith(`/`)) {
    return withoutPrefix.split(`/`).filter(Boolean).at(-1) ?? withoutPrefix
  }
  return withoutPrefix || decoded || principalUrl
}

function principalRole(principalUrl: string): `agent` | `user` | `system` {
  const raw = principalUrl.split(`/principal/`).at(-1) ?? principalUrl
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Keep the raw value when the URL segment is not URI encoded.
  }
  if (decoded.startsWith(`user:`)) return `user`
  if (decoded.startsWith(`system:`)) return `system`
  return `agent`
}

function principalColor(principalUrl: string): {
  color: string
  colorLight: string
} {
  const colors = [
    [`#2563eb`, `#2563eb33`],
    [`#059669`, `#05966933`],
    [`#dc2626`, `#dc262633`],
    [`#7c3aed`, `#7c3aed33`],
    [`#c2410c`, `#c2410c33`],
    [`#0f766e`, `#0f766e33`],
  ] as const
  let hash = 0
  for (let i = 0; i < principalUrl.length; i += 1) {
    hash = (hash * 31 + principalUrl.charCodeAt(i)) >>> 0
  }
  const [color, colorLight] = colors[hash % colors.length]!
  return { color, colorLight }
}
