import { describe, expect, it, vi } from 'vitest'
import * as decoding from 'lib0/decoding'
import { Awareness, applyAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  createMarkdownYDoc,
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

function createToolContext() {
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
  return {
    context: {
      entityUrl: `/chat/session`,
      entityType: `chat`,
      principal: { url: `/principal/agent:horton`, kind: `agent` },
      args: {},
      db: { collections: { manifests: { toArray: [document] } } },
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
      upsertCronSchedule: vi.fn(),
      upsertFutureSendSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
      listEventSources: vi.fn(),
      subscribeToEventSource: vi.fn(),
      unsubscribeFromEventSource: vi.fn(),
    } as any,
    getContent: () => contentFromStream(concatFrames(streamFrames)),
    getDoc: () => createMarkdownYDoc(concatFrames(streamFrames)),
    getAwarenessFrames: () => awarenessFrames,
    appendExternalText: (text: string) => {
      const streamBytes = concatFrames(streamFrames)
      const doc = createMarkdownYDoc(streamBytes)
      const yText = markdownText(doc)
      const before = Y.encodeStateVector(doc)
      yText.insert(yText.length, text)
      streamFrames.push(frameYjsUpdate(Y.encodeStateAsUpdate(doc, before)))
    },
  }
}

describe(`markdown document tools`, () => {
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
    expect(context.readMarkdownDocumentStream).toHaveBeenCalledTimes(2)
    expect(context.readMarkdownDocumentStream).toHaveBeenNthCalledWith(
      2,
      `/v1/yjs/default/docs/agents/chat/session/documents/notes`,
      { offset: `1` }
    )
  })
})
