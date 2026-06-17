import { describe, expect, it, vi } from 'vitest'
import * as decoding from 'lib0/decoding'
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  createMarkdownYDoc,
  encodeMarkdownAwarenessUpdate,
  frameYjsUpdate,
  markdownText,
} from '../src/markdown-yjs'
import { createMarkdownDocumentTools } from '../src/tools/markdown-docs'

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const next = new Uint8Array(a.length + b.length)
  next.set(a, 0)
  next.set(b, a.length)
  return next
}

function concatFrames(frames: Array<Uint8Array>): Uint8Array {
  return frames.reduce(
    (bytes, frame) => concatBytes(bytes, frame),
    new Uint8Array()
  )
}

function streamBytesFromContent(content: string): Uint8Array {
  const doc = new Y.Doc()
  markdownText(doc).insert(0, content)
  return frameYjsUpdate(Y.encodeStateAsUpdate(doc))
}

function contentFromStream(streamBytes: Uint8Array): string {
  return markdownText(createMarkdownYDoc(streamBytes)).toString()
}

async function waitForCondition(
  predicate: () => boolean,
  message: string
): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(message)
}

function applyFramedAwarenessUpdate(
  awareness: Awareness,
  data: Uint8Array
): void {
  const decoder = decoding.createDecoder(data)
  while (decoding.hasContent(decoder)) {
    applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), `test`)
  }
}

function cursorHeadIndexFromAwarenessFrame(
  doc: Y.Doc,
  frame: Uint8Array
): number | undefined {
  const awareness = new Awareness(new Y.Doc())
  applyFramedAwarenessUpdate(awareness, frame)
  for (const state of awareness.getStates().values()) {
    const cursor = (
      state as {
        cursor?: { head?: Y.RelativePosition; anchor?: Y.RelativePosition }
      }
    ).cursor
    if (!cursor?.head) continue
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      cursor.head,
      doc
    )
    return absolute?.index
  }
  return undefined
}

function createToolContext(
  opts: {
    manifestDocuments?: Array<unknown>
    markdownDocs?: Array<unknown>
    entityUrl?: string
    principalUrl?: string
  } = {}
) {
  const document = {
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
    createdAt: `2026-06-07T00:00:00.000Z`,
  } as const
  let streamFrames = [streamBytesFromContent(`# Notes\n\nFirst line\n`)]
  const awarenessFrames: Array<Uint8Array> = []
  const openSessions: Array<{
    doc: Y.Doc
    off: () => void
  }> = []
  const cleanupCallbacks: Array<() => void | Promise<void>> = []
  const context: any = {
    entityUrl: opts.entityUrl ?? `/chat/session`,
    entityType: `chat`,
    principal: {
      url: opts.principalUrl ?? `/principal/agent:horton`,
      kind: `agent`,
    },
    args: {
      ...(opts.markdownDocs ? { markdownDocs: opts.markdownDocs } : {}),
    },
    db: {
      collections: {
        manifests: { toArray: opts.manifestDocuments ?? [document] },
      },
    },
    events: [],
    createMarkdownDocument: vi.fn(
      async (opts: { id?: string; title: string }) => {
        streamFrames = []
        return {
          txid: `tx-create`,
          document: {
            ...document,
            id: opts.id ?? document.id,
            title: opts.title,
          },
        }
      }
    ),
    getMarkdownDocumentConnection: vi.fn(async () => ({
      baseUrl: `http://test.local/v1/yjs/default`,
      docId: document.docId,
      headers: {},
    })),
    openMarkdownDocumentSession: vi.fn(
      async ({
        document,
        entityUrl,
        principal,
      }: {
        document: any
        entityUrl: string
        principal?: { url?: string }
      }) => {
        const ydoc = createMarkdownYDoc(concatFrames(streamFrames))
        const text = markdownText(ydoc, document.yTextName)
        const onUpdate = (update: Uint8Array, origin: unknown): void => {
          if (origin === `server`) return
          void context.appendMarkdownDocumentUpdate(
            document.streamPath,
            frameYjsUpdate(update)
          )
        }
        ydoc.on(`update`, onUpdate)
        openSessions.push({
          doc: ydoc,
          off: () => ydoc.off(`update`, onUpdate),
        })
        const principalUrl =
          principal?.url ?? `/principal/entity:${encodeURIComponent(entityUrl)}`
        return {
          document,
          doc: ydoc,
          text,
          textName: document.yTextName,
          content: () => text.toString(),
          setPresence: vi.fn(
            async (presence: {
              anchor?: number
              head?: number
              clear?: boolean
            }) => {
              void context.appendMarkdownDocumentAwareness(
                document.streamPath,
                encodeMarkdownAwarenessUpdate({
                  doc: ydoc,
                  docPath: document.docPath,
                  principalUrl,
                  clientKey: `${principalUrl}\0${entityUrl}`,
                  name: principalUrl,
                  role: `agent`,
                  anchor: presence.anchor,
                  head: presence.head,
                  clear: presence.clear,
                  color: `#000000`,
                  colorLight: `#00000033`,
                  textName: document.yTextName,
                })
              )
            }
          ),
          flush: vi.fn(async () => {}),
          close: vi.fn(async () => {
            ydoc.off(`update`, onUpdate)
            ydoc.destroy()
          }),
        }
      }
    ),
    readMarkdownDocumentStream: vi.fn(
      async (_streamPath: string, opts?: { offset?: string }) => {
        const offset =
          opts?.offset !== undefined ? Number.parseInt(opts.offset, 10) : 0
        const start = Number.isFinite(offset) && offset >= 0 ? offset : 0
        return {
          bytes: concatFrames(streamFrames.slice(start)),
          offset: String(streamFrames.length),
        }
      }
    ),
    appendMarkdownDocumentUpdate: vi.fn(
      async (_streamPath: string, update: Uint8Array) => {
        streamFrames.push(update)
        return { offset: String(streamFrames.length) }
      }
    ),
    appendMarkdownDocumentAwareness: vi.fn(
      async (_streamPath: string, update: Uint8Array) => {
        awarenessFrames.push(update)
        return {}
      }
    ),
    registerCleanup: vi.fn((cleanup: () => void | Promise<void>) => {
      cleanupCallbacks.push(cleanup)
    }),
    upsertCronSchedule: vi.fn(),
    upsertFutureSendSchedule: vi.fn(),
    deleteSchedule: vi.fn(),
    listEventSources: vi.fn(),
    subscribeToEventSource: vi.fn(),
    unsubscribeFromEventSource: vi.fn(),
  }
  return {
    context,
    getContent: () => contentFromStream(concatFrames(streamFrames)),
    getDoc: () => createMarkdownYDoc(concatFrames(streamFrames)),
    getAwarenessFrames: () => awarenessFrames,
    appendExternalText: (text: string) => {
      const streamBytes = concatFrames(streamFrames)
      const doc = createMarkdownYDoc(streamBytes)
      const yText = markdownText(doc)
      const before = Y.encodeStateVector(doc)
      yText.insert(yText.length, text)
      const update = Y.encodeStateAsUpdate(doc, before)
      streamFrames.push(frameYjsUpdate(update))
      for (const session of openSessions) {
        Y.applyUpdate(session.doc, update, `server`)
      }
      doc.destroy()
    },
    cleanup: async () => {
      for (const cleanup of cleanupCallbacks) await cleanup()
      for (const session of openSessions) session.off()
    },
    document,
  }
}

describe(`markdown document tools`, () => {
  it(`uses the optional awareness client key to distinguish same-principal editors`, () => {
    const doc = new Y.Doc()
    markdownText(doc).insert(0, `hello`)
    const awareness = new Awareness(new Y.Doc())

    applyFramedAwarenessUpdate(
      awareness,
      encodeMarkdownAwarenessUpdate({
        doc,
        docPath: `agents/chat/session/documents/notes`,
        principalUrl: `/principal/agent:horton`,
        clientKey: `/principal/agent:horton\0/chat/session`,
        name: `horton`,
        role: `agent`,
        color: `#000000`,
        colorLight: `#00000033`,
      })
    )
    applyFramedAwarenessUpdate(
      awareness,
      encodeMarkdownAwarenessUpdate({
        doc,
        docPath: `agents/chat/session/documents/notes`,
        principalUrl: `/principal/agent:horton`,
        clientKey: `/principal/agent:horton\0/worker/one`,
        name: `worker`,
        role: `agent`,
        color: `#111111`,
        colorLight: `#11111133`,
      })
    )

    const remoteStates = Array.from(awareness.getStates()).filter(
      ([clientId]) => clientId !== awareness.clientID
    )
    expect(remoteStates).toHaveLength(2)
  })

  it(`creates the server document empty and appends initial content as a Yjs update`, async () => {
    const { context, getContent } = createToolContext()
    const create = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `create_markdown_doc`
    )!

    await create.execute(`tool-create`, {
      id: `notes`,
      title: `Notes`,
      content: `# Created\n\nInitial content`,
    })

    expect(context.createMarkdownDocument).toHaveBeenCalledWith({
      id: `notes`,
      title: `Notes`,
    })
    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(1)
    expect(getContent()).toBe(`# Created\n\nInitial content`)
  })

  it(`materializes and edits markdown documents through Yjs stream updates`, async () => {
    const { context, getContent } = createToolContext()
    const edit = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `edit_markdown_doc`
    )!

    const result = await edit.execute(`tool-edit`, {
      id: `notes`,
      old_string: `First`,
      new_string: `Second`,
    })

    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(1)
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalled()
    expect(getContent()).toContain(`Second line`)
    expect(result.details).toMatchObject({ replacements: 1 })
  })

  it(`reads injected markdown document refs without a local manifest entry`, async () => {
    const base = createToolContext()
    const { context } = createToolContext({
      manifestDocuments: [],
      markdownDocs: [base.document],
      entityUrl: `/worker/subagent`,
    })
    const read = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `read_markdown_doc`
    )!

    const result = await read.execute(`tool-read-injected`, { id: `notes` })

    expect(context.openMarkdownDocumentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        document: base.document,
        entityUrl: `/worker/subagent`,
      })
    )
    expect((result.content[0] as { text: string }).text).toContain(`# Notes`)
  })

  it(`edits a read document and returns a diff`, async () => {
    const { context, getContent } = createToolContext()
    const tools = createMarkdownDocumentTools(context)
    const read = tools.find((tool) => tool.name === `read_markdown_doc`)!
    const edit = tools.find((tool) => tool.name === `edit_markdown_doc`)!

    await read.execute(`tool-read`, { id: `notes` })
    const result = await edit.execute(`tool-edit`, {
      id: `notes`,
      old_string: `First line`,
      new_string: `Second line`,
    })

    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(1)
    expect(getContent()).toContain(`Second line`)
    expect(result.details).toMatchObject({ replacements: 1 })
    expect(String((result.details as any).diff)).toContain(`Second line`)
  })

  it(`streams insert_markdown_doc content deltas before final execution`, async () => {
    const { context, getContent, getDoc, getAwarenessFrames } =
      createToolContext()
    const insert = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `insert_markdown_doc`
    )!

    await insert.onArgsDelta?.({
      toolCallId: `tool-insert`,
      toolName: `insert_markdown_doc`,
      delta: `"Hello`,
      argsPreview: { id: `notes`, content: `Hello` },
    })
    await waitForCondition(
      () => context.appendMarkdownDocumentAwareness.mock.calls.length === 1,
      `expected first streamed insert presence update`
    )
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalledTimes(1)
    expect(
      cursorHeadIndexFromAwarenessFrame(getDoc(), getAwarenessFrames().at(-1)!)
    ).toBe(getContent().length)

    await insert.onArgsDelta?.({
      toolCallId: `tool-insert`,
      toolName: `insert_markdown_doc`,
      delta: ` world"`,
      argsPreview: { id: `notes`, content: `Hello world` },
    })
    await waitForCondition(
      () => context.appendMarkdownDocumentAwareness.mock.calls.length === 2,
      `expected second streamed insert presence update`
    )
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalledTimes(2)
    expect(
      cursorHeadIndexFromAwarenessFrame(getDoc(), getAwarenessFrames().at(-1)!)
    ).toBe(getContent().length)

    const result = await insert.execute(`tool-insert`, {
      id: `notes`,
      content: `Hello world`,
    })

    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(2)
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalledTimes(3)
    expect(getContent()).toContain(`Hello world`)
    expect(result.details).toMatchObject({ streamed: true })
  })

  it(`streams insert_markdown_doc at a saved Yjs-relative cursor`, async () => {
    const { context, getContent } = createToolContext()
    const tools = createMarkdownDocumentTools(context)
    const setCursor = tools.find(
      (tool) => tool.name === `set_markdown_doc_cursor`
    )!
    const insert = tools.find((tool) => tool.name === `insert_markdown_doc`)!

    const cursorResult = await setCursor.execute(`tool-cursor`, {
      id: `notes`,
      after: `# Notes\n`,
    })
    expect(cursorResult.details).toMatchObject({
      cursorSet: true,
      index: `# Notes\n`.length,
    })

    await insert.onArgsDelta?.({
      toolCallId: `tool-insert-cursor`,
      toolName: `insert_markdown_doc`,
      delta: `"Inserted`,
      argsPreview: { id: `notes`, content: `Inserted` },
    })
    await insert.onArgsDelta?.({
      toolCallId: `tool-insert-cursor`,
      toolName: `insert_markdown_doc`,
      delta: ` text\n"`,
      argsPreview: { id: `notes`, content: `Inserted text\n` },
    })

    await insert.execute(`tool-insert-cursor`, {
      id: `notes`,
      content: `Inserted text\n`,
    })

    expect(getContent()).toBe(`# Notes\nInserted text\n\nFirst line\n`)
    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(2)
  })

  it(`replaces a markdown range with one delete update and one insert update`, async () => {
    const { context, getContent } = createToolContext()
    const replace = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `replace_markdown_doc_range`
    )!

    const result = await replace.execute(`tool-replace`, {
      id: `notes`,
      old_string: `First line`,
      content: `Replacement line`,
    })

    expect(getContent()).toBe(`# Notes\n\nReplacement line\n`)
    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(2)
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalledTimes(4)
    expect(result.details).toMatchObject({
      replaced: true,
      deleted: `First line`,
      streamed: false,
    })
  })

  it(`streams replace_markdown_doc_range replacement content at the deleted range`, async () => {
    const { context, getContent, getDoc, getAwarenessFrames } =
      createToolContext()
    const replace = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `replace_markdown_doc_range`
    )!

    await replace.onArgsDelta?.({
      toolCallId: `tool-stream-replace`,
      toolName: `replace_markdown_doc_range`,
      delta: `"Replacement`,
      argsPreview: {
        id: `notes`,
        old_string: `First line`,
        content: `Replacement`,
      },
    })
    await waitForCondition(
      () => context.appendMarkdownDocumentAwareness.mock.calls.length === 3,
      `expected replacement delete and first streamed insert presence updates`
    )
    expect(getContent()).toBe(`# Notes\n\nReplacement\n`)
    expect(
      cursorHeadIndexFromAwarenessFrame(getDoc(), getAwarenessFrames().at(-1)!)
    ).toBe(getContent().length - 1)

    await replace.onArgsDelta?.({
      toolCallId: `tool-stream-replace`,
      toolName: `replace_markdown_doc_range`,
      delta: ` line"`,
      argsPreview: {
        id: `notes`,
        old_string: `First line`,
        content: `Replacement line`,
      },
    })
    await waitForCondition(
      () => context.appendMarkdownDocumentAwareness.mock.calls.length === 4,
      `expected second streamed replacement presence update`
    )
    expect(getContent()).toBe(`# Notes\n\nReplacement line\n`)
    expect(
      cursorHeadIndexFromAwarenessFrame(getDoc(), getAwarenessFrames().at(-1)!)
    ).toBe(getContent().length - 1)

    const result = await replace.execute(`tool-stream-replace`, {
      id: `notes`,
      old_string: `First line`,
      content: `Replacement line`,
    })

    expect(context.appendMarkdownDocumentUpdate).toHaveBeenCalledTimes(3)
    expect(context.appendMarkdownDocumentAwareness).toHaveBeenCalledTimes(5)
    expect(result.details).toMatchObject({
      replaced: true,
      streamed: true,
      deleted: `First line`,
    })
  })

  it(`refreshes a cached Yjs document from the stream before editing`, async () => {
    const { context, getContent, appendExternalText } = createToolContext()
    const tools = createMarkdownDocumentTools(context)
    const read = tools.find((tool) => tool.name === `read_markdown_doc`)!
    const edit = tools.find((tool) => tool.name === `edit_markdown_doc`)!

    await read.execute(`tool-read`, { id: `notes` })
    appendExternalText(`External line\n`)

    await edit.execute(`tool-edit`, {
      id: `notes`,
      old_string: `External line`,
      new_string: `Refreshed line`,
    })

    expect(getContent()).toContain(`Refreshed line`)
    expect(context.readMarkdownDocumentStream).not.toHaveBeenCalled()
    expect(context.openMarkdownDocumentSession).toHaveBeenCalledTimes(1)
  })
})
