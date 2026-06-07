import { describe, expect, it, vi } from 'vitest'
import { createMarkdownDocumentTools } from '../src/tools/markdown-docs'

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
  let content = `# Notes\n\nFirst line\n`
  return {
    context: {
      entityUrl: `/chat/session`,
      entityType: `chat`,
      args: {},
      db: { collections: { manifests: { toArray: [] } } },
      events: [],
      createMarkdownDocument: vi.fn(
        async (opts: { id?: string; title: string; content?: string }) => {
          content = opts.content ?? ``
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
      readMarkdownDocument: vi.fn(async () => ({ document, content })),
      writeMarkdownDocument: vi.fn(
        async (opts: { id: string; content: string }) => {
          content = opts.content
          return { txid: `tx-write`, document, content }
        }
      ),
      editMarkdownDocument: vi.fn(
        async (opts: {
          oldString: string
          newString: string
          replaceAll?: boolean
        }) => {
          content = opts.replaceAll
            ? content.split(opts.oldString).join(opts.newString)
            : content.replace(opts.oldString, opts.newString)
          return { txid: `tx-edit`, document, content }
        }
      ),
      upsertCronSchedule: vi.fn(),
      upsertFutureSendSchedule: vi.fn(),
      deleteSchedule: vi.fn(),
      listEventSources: vi.fn(),
      subscribeToEventSource: vi.fn(),
      unsubscribeFromEventSource: vi.fn(),
    } as any,
    getContent: () => content,
  }
}

describe(`markdown document tools`, () => {
  it(`requires read_markdown_doc before edit_markdown_doc`, async () => {
    const { context } = createToolContext()
    const edit = createMarkdownDocumentTools(context).find(
      (tool) => tool.name === `edit_markdown_doc`
    )!

    const result = await edit.execute(`tool-edit`, {
      id: `notes`,
      old_string: `First`,
      new_string: `Second`,
    })

    expect(context.editMarkdownDocument).not.toHaveBeenCalled()
    expect(result.details).toMatchObject({ replacements: 0 })
    expect(result.content[0]).toMatchObject({
      type: `text`,
      text: expect.stringContaining(`read_markdown_doc first`),
    })
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

    expect(context.editMarkdownDocument).toHaveBeenCalledWith({
      id: `notes`,
      oldString: `First line`,
      newString: `Second line`,
      replaceAll: undefined,
    })
    expect(getContent()).toContain(`Second line`)
    expect(result.details).toMatchObject({ replacements: 1 })
    expect(String((result.details as any).diff)).toContain(`Second line`)
  })
})
