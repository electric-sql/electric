import { createTwoFilesPatch } from 'diff'
import { Type } from '@sinclair/typebox'
import {
  applyFramedYjsUpdates,
  createMarkdownYDoc,
  editMarkdownText,
  encodeMarkdownAwarenessUpdate,
  frameYjsUpdate,
  insertMarkdownText,
  markdownIndexFromRelativePosition,
  markdownText,
  relativePositionAtMarkdownIndex,
  replaceMarkdownText,
} from '../markdown-yjs'
import type { AgentTool, ProcessWakeConfig } from '../types'
import type { ManifestDocumentEntry } from '../entity-schema'
import type * as Y from 'yjs'

type ElectricToolContext = Parameters<
  NonNullable<ProcessWakeConfig[`createElectricTools`]>
>[0]

function docLabel(id: string): string {
  return `markdown-doc:${id}`
}

type InsertMarkdownArgs = {
  id: string
  content: string
  index?: number
}

type SetCursorArgs = {
  id: string
  index?: number
  before?: string
  after?: string
  occurrence?: number
}

type InsertSession = {
  id?: string
  inserted: string
  nextIndex?: number
  nextPosition?: Y.RelativePosition
  seq: number
  streamed: boolean
  pending: Promise<void>
  error?: unknown
}

type MaterializedMarkdownDocument = {
  document: ManifestDocumentEntry
  doc: Y.Doc
  textName: string
  streamOffset?: string
}

function isManifestDocumentEntry(
  value: unknown
): value is ManifestDocumentEntry {
  if (!value || typeof value !== `object`) return false
  const entry = value as Partial<ManifestDocumentEntry>
  return (
    entry.kind === `document` &&
    typeof entry.id === `string` &&
    entry.provider === `y-durable-streams` &&
    typeof entry.docPath === `string` &&
    typeof entry.streamPath === `string` &&
    entry.transportMimeType ===
      `application/vnd.electric-agents.markdown-yjs` &&
    entry.contentMimeType === `text/markdown` &&
    entry.yTextName === `markdown` &&
    typeof entry.title === `string`
  )
}

function asInsertArgs(value: unknown): Partial<InsertMarkdownArgs> {
  if (!value || typeof value !== `object`) return {}
  const input = value as Record<string, unknown>
  return {
    ...(typeof input.id === `string` && { id: input.id }),
    ...(typeof input.content === `string` && { content: input.content }),
    ...(typeof input.index === `number` && Number.isFinite(input.index)
      ? { index: input.index }
      : {}),
  }
}

export function createMarkdownDocumentTools(
  context: ElectricToolContext
): Array<AgentTool> {
  const readDocs = new Map<string, string>()
  const insertSessions = new Map<string, InsertSession>()
  const materializedDocs = new Map<string, MaterializedMarkdownDocument>()
  const cursorPositions = new Map<string, Y.RelativePosition>()

  const findManifestDocument = (
    id: string
  ): ManifestDocumentEntry | undefined => {
    const manifests = context.db.collections.manifests?.toArray as
      | Array<unknown>
      | undefined
    return manifests?.find(
      (entry): entry is ManifestDocumentEntry =>
        isManifestDocumentEntry(entry) && entry.id === id
    )
  }

  const refreshDocument = async (
    id: string,
    materialized: MaterializedMarkdownDocument
  ): Promise<void> => {
    const result = await context.readMarkdownDocumentStream(
      materialized.document.streamPath,
      materialized.streamOffset
        ? { offset: materialized.streamOffset }
        : undefined
    )
    applyFramedYjsUpdates(materialized.doc, result.bytes)
    if (result.offset !== undefined) {
      materialized.streamOffset = result.offset
    }
    readDocs.set(id, contentOf(materialized))
  }

  const materializeDocument = async (
    id: string
  ): Promise<MaterializedMarkdownDocument> => {
    const cached = materializedDocs.get(id)
    if (cached) {
      await refreshDocument(id, cached)
      return cached
    }
    const document = findManifestDocument(id)
    if (!document) {
      throw new Error(
        `Markdown document ${JSON.stringify(
          id
        )} is not in this entity's manifest. Create it with create_markdown_doc first.`
      )
    }
    const result = await context.readMarkdownDocumentStream(document.streamPath)
    const doc = createMarkdownYDoc(result.bytes)
    const materialized = {
      document,
      doc,
      textName: document.yTextName,
      ...(result.offset !== undefined ? { streamOffset: result.offset } : {}),
    }
    materializedDocs.set(id, materialized)
    readDocs.set(id, markdownText(doc, document.yTextName).toString())
    return materialized
  }

  const contentOf = (materialized: MaterializedMarkdownDocument): string =>
    markdownText(materialized.doc, materialized.textName).toString()

  const cacheEmptyDocument = (
    document: ManifestDocumentEntry
  ): MaterializedMarkdownDocument => {
    const materialized = {
      document,
      doc: createMarkdownYDoc(new Uint8Array()),
      textName: document.yTextName,
    }
    materializedDocs.set(document.id, materialized)
    readDocs.set(document.id, ``)
    return materialized
  }

  const appendDocumentUpdate = async (
    id: string,
    materialized: MaterializedMarkdownDocument,
    update: Uint8Array
  ): Promise<void> => {
    if (update.length === 0) return
    try {
      const result = await context.appendMarkdownDocumentUpdate(
        materialized.document.streamPath,
        frameYjsUpdate(update)
      )
      if (result.offset !== undefined) {
        materialized.streamOffset = result.offset
      }
    } catch (error) {
      materializedDocs.delete(id)
      throw error
    }
    readDocs.set(id, contentOf(materialized))
  }

  const appendPresence = async (
    materialized: MaterializedMarkdownDocument,
    opts: { anchor?: number; head?: number; clear?: boolean }
  ): Promise<void> => {
    const principalUrl =
      context.principal?.url ??
      `/principal/entity:${encodeURIComponent(context.entityUrl)}`
    await context
      .appendMarkdownDocumentAwareness(
        materialized.document.streamPath,
        encodeMarkdownAwarenessUpdate({
          doc: materialized.doc,
          docPath: materialized.document.docPath,
          principalUrl,
          name: principalDisplayName(principalUrl),
          role: principalRole(principalUrl),
          status: `editing`,
          anchor: opts.anchor,
          head: opts.head,
          color: principalColor(principalUrl).color,
          colorLight: principalColor(principalUrl).colorLight,
          clear: opts.clear,
          textName: materialized.textName,
        })
      )
      .catch(() => undefined)
  }

  const applyInsertChunk = async (
    id: string,
    chunk: string,
    session: InsertSession,
    index?: number
  ): Promise<void> => {
    const materialized = await materializeDocument(id)
    const result = insertMarkdownText(materialized.doc, chunk, {
      index: session.nextPosition
        ? undefined
        : (session.nextIndex ?? (index !== undefined ? index : undefined)),
      position:
        session.nextPosition ??
        (index === undefined ? cursorPositions.get(id) : undefined),
      textName: materialized.textName,
    })
    await appendDocumentUpdate(id, materialized, result.update)
    await appendPresence(materialized, {
      anchor: result.nextIndex,
      head: result.nextIndex,
    })
    session.nextIndex = result.nextIndex
    session.nextPosition = result.nextPosition
    cursorPositions.set(id, result.nextPosition)
    session.streamed = true
  }

  const setCursor = async (
    id: string,
    index: number
  ): Promise<{ materialized: MaterializedMarkdownDocument; index: number }> => {
    const materialized = await materializeDocument(id)
    const text = markdownText(materialized.doc, materialized.textName)
    const boundedIndex = Math.max(0, Math.min(index, text.length))
    const position = relativePositionAtMarkdownIndex(
      materialized.doc,
      boundedIndex,
      materialized.textName
    )
    cursorPositions.set(id, position)
    return { materialized, index: boundedIndex }
  }

  const resolveCursorIndex = (
    content: string,
    args: SetCursorArgs
  ): { index?: number; error?: string } => {
    const locatorCount =
      (args.index !== undefined ? 1 : 0) +
      (args.before !== undefined ? 1 : 0) +
      (args.after !== undefined ? 1 : 0)
    if (locatorCount > 1) {
      return { error: `Pass only one of index, before, or after.` }
    }
    if (args.index !== undefined) return { index: args.index }
    const needle = args.before ?? args.after
    if (needle === undefined) return { index: content.length }
    if (needle.length === 0) {
      return { error: `before/after must not be empty.` }
    }
    const occurrence = Math.max(1, Math.floor(args.occurrence ?? 1))
    let from = 0
    let found = -1
    for (let count = 0; count < occurrence; count += 1) {
      found = content.indexOf(needle, from)
      if (found < 0) {
        return {
          error: `Could not find occurrence ${occurrence} of ${JSON.stringify(
            needle
          )}.`,
        }
      }
      from = found + needle.length
    }
    return { index: args.after !== undefined ? found + needle.length : found }
  }

  const enqueueInsert = (
    toolCallId: string,
    action: (session: InsertSession) => Promise<void>
  ): void => {
    const session =
      insertSessions.get(toolCallId) ??
      ({
        inserted: ``,
        seq: 0,
        streamed: false,
        pending: Promise.resolve(),
      } satisfies InsertSession)
    insertSessions.set(toolCallId, session)
    session.pending = session.pending
      .then(() => action(session))
      .catch((error) => {
        session.error = error
      })
  }

  const awaitInsertSession = async (
    toolCallId: string
  ): Promise<InsertSession | undefined> => {
    const session = insertSessions.get(toolCallId)
    if (!session) return undefined
    await session.pending
    if (session.error) throw session.error
    return session
  }

  return [
    {
      name: `create_markdown_doc`,
      label: `Create Markdown Doc`,
      description: `Create a collaborative markdown document, persist it as Yjs updates, and add it to this entity's manifest so users can open it in the app. This is not a filesystem file.`,
      parameters: Type.Object({
        title: Type.String({ description: `Document title shown in the UI.` }),
        content: Type.Optional(
          Type.String({ description: `Initial markdown content.` })
        ),
        id: Type.Optional(
          Type.String({
            description: `Optional stable document id. Use letters, numbers, hyphens, or underscores.`,
          })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const { id, title, content } = params as {
          id?: string
          title: string
          content?: string
        }
        const result = await context.createMarkdownDocument({
          id,
          title,
        })
        const materialized = cacheEmptyDocument(result.document)
        if (content && content.length > 0) {
          await appendPresence(materialized, { anchor: 0, head: 0 })
          const update = replaceMarkdownText(
            materialized.doc,
            content,
            materialized.textName
          )
          await appendDocumentUpdate(result.document.id, materialized, update)
          await appendPresence(materialized, {
            anchor: content.length,
            head: content.length,
          })
          await appendPresence(materialized, { clear: true })
        }
        return {
          content: [
            {
              type: `text` as const,
              text: `Created markdown document ${result.document.id}: ${result.document.title}`,
            },
          ],
          details: { document: result.document, txid: result.txid },
        }
      },
    },
    {
      name: `set_markdown_doc_cursor`,
      label: `Set Markdown Doc Cursor`,
      description: `Set the stateful insertion cursor for a collaborative markdown document. The cursor is stored as a Yjs relative position for this wake, so later insert_markdown_doc calls can stream at that position even if the document changes around it. Pass exactly one of index, before, or after; omit all three to place the cursor at the end.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        index: Type.Optional(
          Type.Number({
            description: `Optional UTF-16 text offset for the cursor.`,
          })
        ),
        before: Type.Optional(
          Type.String({
            description: `Place the cursor before this literal markdown text.`,
          })
        ),
        after: Type.Optional(
          Type.String({
            description: `Place the cursor after this literal markdown text.`,
          })
        ),
        occurrence: Type.Optional(
          Type.Number({
            description: `1-based occurrence for before/after matching. Defaults to 1.`,
          })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const args = params as SetCursorArgs
        const materialized = await materializeDocument(args.id)
        const content = contentOf(materialized)
        const resolved = resolveCursorIndex(content, args)
        if (resolved.error || resolved.index === undefined) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: ${resolved.error ?? `could not resolve cursor`}`,
              },
            ],
            details: { cursorSet: false },
          }
        }
        const result = await setCursor(args.id, resolved.index)
        return {
          content: [
            {
              type: `text` as const,
              text: `Set markdown document ${args.id} cursor at index ${result.index}`,
            },
          ],
          details: {
            document: result.materialized.document,
            cursorSet: true,
            index: result.index,
          },
        }
      },
    },
    {
      name: `insert_markdown_doc`,
      label: `Insert Markdown Doc`,
      description: `Insert markdown into a collaborative app document. When the model streams the content argument, the insertion is applied incrementally to the wake-local Yjs document and appended to the document stream so open editors can watch it appear. Put id and optional index before content in the tool arguments. If index is omitted, the current set_markdown_doc_cursor position is used; if no cursor is set, content is appended.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        index: Type.Optional(
          Type.Number({
            description: `Optional UTF-16 text offset. Omit to append to the end of the current document.`,
          })
        ),
        content: Type.String({ description: `Markdown content to insert.` }),
      }),
      onArgsDelta: ({ toolCallId, argsPreview }) => {
        const args = asInsertArgs(argsPreview)
        if (!args.id || typeof args.content !== `string`) return
        enqueueInsert(toolCallId, async (session) => {
          session.id = args.id
          if (session.nextIndex === undefined && args.index !== undefined) {
            session.nextIndex = args.index
          }
          if (!args.content!.startsWith(session.inserted)) return
          const chunk = args.content!.slice(session.inserted.length)
          if (chunk.length === 0) return
          session.inserted = args.content!
          await applyInsertChunk(args.id!, chunk, session, args.index)
          session.seq++
        })
      },
      execute: async (toolCallId, params) => {
        const { id, content, index } = params as InsertMarkdownArgs
        const session = await awaitInsertSession(toolCallId)
        let inserted = session?.inserted ?? ``
        let streamed = session?.streamed ?? false
        let nextIndex = session?.nextIndex ?? index

        if (content !== inserted) {
          if (inserted.length === 0 || content.startsWith(inserted)) {
            const remaining =
              inserted.length === 0 ? content : content.slice(inserted.length)
            if (remaining.length > 0) {
              const finalSession =
                session ??
                ({
                  inserted: ``,
                  seq: 0,
                  streamed: false,
                  pending: Promise.resolve(),
                } satisfies InsertSession)
              await applyInsertChunk(id, remaining, finalSession, nextIndex)
              nextIndex = finalSession.nextIndex
              inserted = content
              streamed = streamed || remaining.length !== content.length
            }
          } else {
            const materialized = materializedDocs.get(id)
            if (materialized) {
              await appendPresence(materialized, { clear: true })
            }
            insertSessions.delete(toolCallId)
            return {
              content: [
                {
                  type: `text` as const,
                  text: `Error: streamed content diverged from final insert content; no final reconciliation was applied.`,
                },
              ],
              details: { inserted: inserted.length, expected: content.length },
            }
          }
        }

        const materialized = await materializeDocument(id)
        await appendPresence(materialized, { clear: true })
        const finalContent = contentOf(materialized)
        readDocs.set(id, finalContent)
        insertSessions.delete(toolCallId)
        return {
          content: [
            {
              type: `text` as const,
              text: `Inserted ${content.length} characters into markdown document ${id}`,
            },
          ],
          details: {
            document: materialized.document,
            streamed,
            insertedBytes: new TextEncoder().encode(content).length,
            nextIndex,
          },
        }
      },
      executionMode: `sequential`,
    },
    {
      name: `read_markdown_doc`,
      label: `Read Markdown Doc`,
      description: `Read the current plain markdown content from a collaborative app document, not from the filesystem.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id } = params as { id: string }
        const materialized = await materializeDocument(id)
        const content = contentOf(materialized)
        const cursorIndex = cursorPositions.has(id)
          ? markdownIndexFromRelativePosition(
              materialized.doc,
              cursorPositions.get(id)!,
              materialized.textName
            )
          : undefined
        readDocs.set(id, content)
        return {
          content: [
            {
              type: `text` as const,
              text: content,
            },
          ],
          details: {
            document: materialized.document,
            bytes: new TextEncoder().encode(content).length,
            cursorIndex,
          },
        }
      },
    },
    {
      name: `write_markdown_doc`,
      label: `Write Markdown Doc`,
      description: `Replace the full content of a collaborative app markdown document. This does not write a filesystem file.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        content: Type.String({ description: `Full markdown content.` }),
      }),
      execute: async (_toolCallId, params) => {
        const { id, content } = params as { id: string; content: string }
        const materialized = await materializeDocument(id)
        const before = contentOf(materialized)
        await appendPresence(materialized, { anchor: 0, head: 0 })
        const update = replaceMarkdownText(
          materialized.doc,
          content,
          materialized.textName
        )
        await appendDocumentUpdate(id, materialized, update)
        await appendPresence(materialized, {
          anchor: content.length,
          head: content.length,
        })
        await appendPresence(materialized, { clear: true })
        readDocs.set(id, content)
        const diff = createTwoFilesPatch(
          docLabel(id),
          docLabel(id),
          before,
          content,
          undefined,
          undefined,
          { context: 3 }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Wrote markdown document ${id}`,
            },
          ],
          details: { document: materialized.document, diff },
        }
      },
      executionMode: `sequential`,
    },
    {
      name: `edit_markdown_doc`,
      label: `Edit Markdown Doc`,
      description: `Replace text in a collaborative app markdown document by appending a Yjs update, not by writing a filesystem file. Read the document first when you need to inspect current content. By default old_string must occur exactly once; set replace_all to true to replace every occurrence.`,
      parameters: Type.Object({
        id: Type.String({ description: `Document id.` }),
        old_string: Type.String({
          description: `Literal markdown text to find. Must be unique unless replace_all is true.`,
        }),
        new_string: Type.String({ description: `Replacement markdown text.` }),
        replace_all: Type.Optional(
          Type.Boolean({ description: `Replace every occurrence.` })
        ),
      }),
      execute: async (_toolCallId, params) => {
        const { id, old_string, new_string, replace_all } = params as {
          id: string
          old_string: string
          new_string: string
          replace_all?: boolean
        }
        const materialized = await materializeDocument(id)
        const before = contentOf(materialized)

        const matches = before.split(old_string).length - 1
        if (matches === 0) {
          return {
            content: [
              { type: `text` as const, text: `Error: old_string not found` },
            ],
            details: { replacements: 0 },
          }
        }
        if (!replace_all && matches > 1) {
          return {
            content: [
              {
                type: `text` as const,
                text: `Error: found ${matches} matches for old_string; pass replace_all=true or provide a more specific old_string.`,
              },
            ],
            details: { replacements: 0 },
          }
        }

        const index = before.indexOf(old_string)
        await appendPresence(materialized, { anchor: index, head: index })
        const result = editMarkdownText(
          materialized.doc,
          old_string,
          new_string,
          replace_all,
          materialized.textName
        )
        await appendDocumentUpdate(id, materialized, result.update)
        await appendPresence(materialized, {
          anchor: result.cursorIndex,
          head: result.cursorIndex,
        })
        await appendPresence(materialized, { clear: true })
        readDocs.set(id, result.content)
        const diff = createTwoFilesPatch(
          docLabel(id),
          docLabel(id),
          before,
          result.content,
          undefined,
          undefined,
          { context: 3 }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Edited markdown document ${id}: ${matches} replacement${
                matches === 1 ? `` : `s`
              }`,
            },
          ],
          details: {
            replacements: matches,
            document: materialized.document,
            diff,
          },
        }
      },
      executionMode: `sequential`,
    },
  ]
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
