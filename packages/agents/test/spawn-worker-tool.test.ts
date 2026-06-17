import { describe, expect, it, vi } from 'vitest'
import {
  WORKER_TOOL_NAMES,
  createSpawnWorkerTool,
} from '../src/tools/spawn-worker'

const manifestDocument = {
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

describe(`spawn_worker tool`, () => {
  it(`runs sequentially because spawning mutates the parent manifest`, () => {
    const tool = createSpawnWorkerTool({ spawn: vi.fn() } as any)

    expect(tool.executionMode).toBe(`sequential`)
  })

  it(`spawns a worker entity with runFinished + includeResponse and forwards the initial message`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx)
    const result = await tool.execute(`call-1`, {
      systemPrompt: `Read /tmp/foo and report its size`,
      tools: [`read`, `bash`],
      initialMessage: `Please check the size of /tmp/foo and report back`,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const call = spawn.mock.calls[0]!
    const [type, id, args, opts] = call as Array<any>
    expect(type).toBe(`worker`)
    expect(typeof id).toBe(`string`)
    expect(id).toMatch(/^read-tmp-foo-report-its-size-check-size-[a-z0-9]{6}$/)
    expect(args).toEqual({
      systemPrompt: `Read /tmp/foo and report its size`,
      tools: [`read`, `bash`],
    })
    expect(opts).toEqual({
      initialMessage: `Please check the size of /tmp/foo and report back`,
      wake: { on: `runFinished`, includeResponse: true },
      sandbox: `inherit`,
    })

    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Worker dispatched/)
    expect(text).toContain(`/worker/${id}`)
    expect(text).toMatch(/end your turn/i)
  })

  it(`uses an optional descriptive worker name with a random suffix`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx)

    await tool.execute(`call-name`, {
      systemPrompt: `Write detailed prose for the first act.`,
      name: `Act One Prose`,
      tools: [`read_markdown_doc`, `insert_markdown_doc`],
      initialMessage: `Expand Act I in the shared markdown document.`,
    })

    const [, id] = spawn.mock.calls[0]! as Array<any>
    expect(id).toMatch(/^act-one-prose-[a-z0-9]{6}$/)
  })

  it(`passes the selected model config to the spawned worker`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx, {
      provider: `openai`,
      model: `gpt-4.1`,
      reasoningEffort: `high`,
    })

    await tool.execute(`call-model`, {
      systemPrompt: `Do a thing`,
      tools: [`read`],
      initialMessage: `Please do it`,
    })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).toEqual({
      systemPrompt: `Do a thing`,
      tools: [`read`],
      provider: `openai`,
      model: `gpt-4.1`,
      reasoningEffort: `high`,
    })
  })

  it(`passes selected collaborative markdown document refs to the spawned worker`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = {
      spawn,
      db: { collections: { manifests: { toArray: [manifestDocument] } } },
    } as any
    const tool = createSpawnWorkerTool(ctx)

    await tool.execute(`call-doc`, {
      systemPrompt: `Edit the shared doc.`,
      tools: [`read_markdown_doc`, `insert_markdown_doc`],
      initialMessage: `Read notes and append a summary.`,
      markdownDocIds: [`notes`],
    })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).toMatchObject({
      systemPrompt: `Edit the shared doc.`,
      tools: [`read_markdown_doc`, `insert_markdown_doc`],
      markdownDocs: [manifestDocument],
    })
  })

  it(`automatically passes current collaborative markdown documents to markdown workers`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = {
      spawn,
      db: { collections: { manifests: { toArray: [manifestDocument] } } },
    } as any
    const tool = createSpawnWorkerTool(ctx)

    await tool.execute(`call-doc-auto`, {
      systemPrompt: `Edit the shared doc.`,
      tools: [`read_markdown_doc`, `edit_markdown_doc`],
      initialMessage: `Read notes and tighten the intro.`,
    })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).toMatchObject({
      systemPrompt: `Edit the shared doc.`,
      tools: [`read_markdown_doc`, `edit_markdown_doc`],
      markdownDocs: [manifestDocument],
    })
  })

  it(`does not inspect markdown docs for workers without markdown document tools`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx)

    await tool.execute(`call-no-doc-auto`, {
      systemPrompt: `Check the repo.`,
      tools: [`read`],
      initialMessage: `Read a file.`,
    })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).toEqual({
      systemPrompt: `Check the repo.`,
      tools: [`read`],
    })
  })

  it(`rejects unknown collaborative markdown document refs`, async () => {
    const spawn = vi.fn()
    const ctx = {
      spawn,
      db: { collections: { manifests: { toArray: [manifestDocument] } } },
    } as any
    const tool = createSpawnWorkerTool(ctx)

    const result = await tool.execute(`call-doc-missing`, {
      systemPrompt: `Edit the shared doc.`,
      tools: [`read_markdown_doc`],
      initialMessage: `Read notes.`,
      markdownDocIds: [`missing`],
    })

    expect((result.content[0] as { text: string }).text).toMatch(
      /not found in this entity's manifest/
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it(`allows workers to request collaborative markdown document tools`, () => {
    expect(WORKER_TOOL_NAMES).toContain(`read_markdown_doc`)
    expect(WORKER_TOOL_NAMES).toContain(`insert_markdown_doc`)
    expect(WORKER_TOOL_NAMES).toContain(`replace_markdown_doc_range`)
  })

  it(`rejects when tools is empty`, async () => {
    const spawn = vi.fn()
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx)
    const result = await tool.execute(`call-2`, {
      systemPrompt: `do something`,
      tools: [],
      initialMessage: `go`,
    })
    expect((result.content[0] as { text: string }).text).toMatch(
      /at least one tool/i
    )
    expect(spawn).not.toHaveBeenCalled()
  })

  it(`rejects when initialMessage is missing or empty`, async () => {
    const spawn = vi.fn()
    const ctx = { spawn } as any
    const tool = createSpawnWorkerTool(ctx)
    const missing = await tool.execute(`call-3`, {
      systemPrompt: `do something`,
      tools: [`bash`],
    } as any)
    expect((missing.content[0] as { text: string }).text).toMatch(
      /initialMessage is required/i
    )
    const empty = await tool.execute(`call-4`, {
      systemPrompt: `do something`,
      tools: [`bash`],
      initialMessage: ``,
    })
    expect((empty.content[0] as { text: string }).text).toMatch(
      /initialMessage is required/i
    )
    expect(spawn).not.toHaveBeenCalled()
  })
})
