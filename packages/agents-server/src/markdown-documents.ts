import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import { applyAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import type { ElectricAgentsEntity } from './electric-agents-types.js'
import type { StreamClient } from './stream-client.js'

export const MARKDOWN_DOCUMENT_TRANSPORT_MIME =
  `application/vnd.electric-agents.markdown-yjs` as const
export const MARKDOWN_DOCUMENT_CONTENT_MIME = `text/markdown` as const
export const MARKDOWN_DOCUMENT_TEXT_NAME = `markdown` as const
export const MARKDOWN_DOCUMENT_PROVIDER = `y-durable-streams` as const

export interface ParsedMarkdownDocumentPath {
  entityType: string
  instanceId: string
  entityUrl: string
  documentId: string
}

export function getMarkdownDocumentDocPath(
  entityUrl: string,
  documentId: string
): string {
  const match = entityUrl.match(/^\/([^/]+)\/([^/]+)$/)
  if (!match) {
    throw new Error(`Invalid entity URL for markdown document: ${entityUrl}`)
  }
  return `agents/${match[1]}/${match[2]}/documents/${documentId}`
}

export function getMarkdownDocumentUrlPath(
  service: string,
  entityUrl: string,
  documentId: string
): string {
  return `/v1/yjs/${encodeURIComponent(service)}/docs/${getMarkdownDocumentDocPath(
    entityUrl,
    documentId
  )}`
}

export function getMarkdownDocumentUpdateStreamPath(
  service: string,
  docPath: string
): string {
  return `/yjs/${service}/docs/${docPath}/.updates`
}

export function getMarkdownDocumentAwarenessStreamPath(
  service: string,
  docPath: string,
  name: string
): string {
  return `/yjs/${service}/docs/${docPath}/.awareness/${name}`
}

export function getMarkdownDocumentIndexStreamPath(
  service: string,
  docPath: string
): string {
  return `/yjs/${service}/docs/${docPath}/.index`
}

export function getMarkdownDocumentSnapshotStreamPath(
  service: string,
  docPath: string,
  snapshotKey: string
): string {
  return `/yjs/${service}/docs/${docPath}/.snapshots/${snapshotKey}`
}

export function parseMarkdownDocumentDocPath(
  docPath: string
): ParsedMarkdownDocumentPath | null {
  const match = docPath.match(
    /^agents\/([^/]+)\/([^/]+)\/documents\/([A-Za-z0-9_-]+)$/
  )
  if (!match) return null
  return {
    entityType: match[1]!,
    instanceId: match[2]!,
    entityUrl: `/${match[1]}/${match[2]}`,
    documentId: match[3]!,
  }
}

export function parseYjsDocumentRoutePath(
  path: string
): { service: string; docPath: string } | null {
  const match = path.match(/^\/v1\/yjs\/([^/]+)\/docs\/(.+)$/)
  if (!match) return null
  let docPath: string
  try {
    docPath = decodeURIComponent(match[2]!)
  } catch {
    return null
  }
  if (
    docPath.includes(`..`) ||
    docPath.split(`/`).some((segment) => segment === `.` || segment === ``)
  ) {
    return null
  }
  return { service: match[1]!, docPath }
}

export function frameYjsUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint8Array(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function applyFramedYjsUpdates(doc: Y.Doc, data: Uint8Array): void {
  if (data.length === 0) return
  const decoder = decoding.createDecoder(data)
  while (decoding.hasContent(decoder)) {
    Y.applyUpdate(doc, decoding.readVarUint8Array(decoder), `server`)
  }
}

export function applyFramedAwarenessUpdates(
  awareness: Parameters<typeof applyAwarenessUpdate>[0],
  data: Uint8Array
): void {
  if (data.length === 0) return
  const decoder = decoding.createDecoder(data)
  while (decoding.hasContent(decoder)) {
    applyAwarenessUpdate(
      awareness,
      decoding.readVarUint8Array(decoder),
      `server`
    )
  }
}

export async function readMarkdownYDoc(
  streamClient: StreamClient,
  updateStreamPath: string
): Promise<Y.Doc> {
  const doc = new Y.Doc()
  const result = await streamClient.read(updateStreamPath)
  for (const message of result.messages) {
    applyFramedYjsUpdates(doc, message.data)
  }
  return doc
}

export function markdownText(doc: Y.Doc): Y.Text {
  return doc.getText(MARKDOWN_DOCUMENT_TEXT_NAME)
}

export function replaceMarkdownText(doc: Y.Doc, content: string): Uint8Array {
  const before = Y.encodeStateVector(doc)
  const text = markdownText(doc)
  doc.transact(() => {
    text.delete(0, text.length)
    if (content.length > 0) text.insert(0, content)
  }, `server`)
  return Y.encodeStateAsUpdate(doc, before)
}

export function entityUrlFromYjsDocumentRoutePath(path: string): string | null {
  const route = parseYjsDocumentRoutePath(path)
  if (!route) return null
  return parseMarkdownDocumentDocPath(route.docPath)?.entityUrl ?? null
}

export function parseMarkdownDocumentStreamPath(
  path: string
): { service: string; docPath: string; entityUrl: string } | null {
  const match = path.match(
    /^\/yjs\/([^/]+)\/docs\/(.+)\/\.(updates|index|awareness|snapshots)(?:\/.*)?$/
  )
  if (!match) return null
  const parsed = parseMarkdownDocumentDocPath(match[2]!)
  if (!parsed) return null
  return {
    service: match[1]!,
    docPath: match[2]!,
    entityUrl: parsed.entityUrl,
  }
}

export function assertMarkdownDocumentMatchesEntity(
  entity: ElectricAgentsEntity,
  docPath: string
): void {
  const parsed = parseMarkdownDocumentDocPath(docPath)
  if (!parsed || parsed.entityUrl !== entity.url) {
    throw new Error(`Markdown document path does not belong to ${entity.url}`)
  }
}
