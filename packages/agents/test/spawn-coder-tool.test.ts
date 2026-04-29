import { describe, expect, it, vi } from 'vitest'
import {
  createPromptCoderTool,
  createSpawnCoderTool,
} from '../src/tools/spawn-coder'

describe(`spawn_coder tool`, () => {
  it(`spawns a coder with default agent and the prompt as initialMessage`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnCoderTool(ctx)
    const result = await tool.execute(`call-1`, {
      prompt: `Build a small README for /tmp/foo`,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const [type, id, args, opts] = spawn.mock.calls[0]! as Array<any>
    expect(type).toBe(`coder`)
    expect(typeof id).toBe(`string`)
    expect(id.length).toBeGreaterThanOrEqual(10)
    expect(args).toEqual({ agent: `claude` })
    expect(opts).toEqual({
      initialMessage: { text: `Build a small README for /tmp/foo` },
      wake: { on: `runFinished`, includeResponse: true },
    })

    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Coder dispatched/)
    expect(text).toContain(`/coder/${id}`)
    expect(text).toMatch(/end your turn/i)
    expect(result.details).toEqual({ spawned: true, coderUrl: `/coder/${id}` })
  })

  it(`forwards explicit agent and cwd`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnCoderTool(ctx)
    await tool.execute(`call-2`, {
      prompt: `do thing`,
      agent: `codex`,
      cwd: `/some/path`,
    })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).toEqual({ agent: `codex`, cwd: `/some/path` })
  })

  it(`omits cwd from spawn args when not provided`, async () => {
    const spawn = vi.fn(async (type, id) => ({
      entityUrl: `/${type}/${id}`,
      writeToken: `tok`,
      txid: 1,
    }))
    const ctx = { spawn } as any
    const tool = createSpawnCoderTool(ctx)
    await tool.execute(`call-3`, { prompt: `do thing` })

    const [, , args] = spawn.mock.calls[0]! as Array<any>
    expect(args).not.toHaveProperty(`cwd`)
  })

  it(`rejects when prompt is missing or empty`, async () => {
    const spawn = vi.fn()
    const ctx = { spawn } as any
    const tool = createSpawnCoderTool(ctx)

    const missing = await tool.execute(`call-4`, {} as any)
    expect((missing.content[0] as { text: string }).text).toMatch(
      /prompt is required/i
    )
    expect(missing.details).toEqual({ spawned: false })

    const empty = await tool.execute(`call-5`, { prompt: `` })
    expect((empty.content[0] as { text: string }).text).toMatch(
      /prompt is required/i
    )
    expect(empty.details).toEqual({ spawned: false })

    expect(spawn).not.toHaveBeenCalled()
  })

  it(`returns an error result when spawn rejects`, async () => {
    const spawn = vi.fn(async () => {
      throw new Error(`boom`)
    })
    const ctx = { spawn } as any
    const tool = createSpawnCoderTool(ctx)
    const result = await tool.execute(`call-6`, { prompt: `do thing` })

    expect((result.content[0] as { text: string }).text).toMatch(
      /Error spawning coder/i
    )
    expect((result.content[0] as { text: string }).text).toContain(`boom`)
    expect(result.details).toEqual({ spawned: false })
  })
})

describe(`prompt_coder tool`, () => {
  it(`sends a follow-up prompt to the given coder URL`, async () => {
    const send = vi.fn()
    const ctx = { send } as any
    const tool = createPromptCoderTool(ctx)
    const result = await tool.execute(`call-1`, {
      coder_url: `/coder/abc123`,
      prompt: `also add a section about Horton`,
    })

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(`/coder/abc123`, {
      text: `also add a section about Horton`,
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Prompt queued/)
    expect(text).toContain(`/coder/abc123`)
    expect(result.details).toEqual({
      sent: true,
      coderUrl: `/coder/abc123`,
    })
  })

  it(`rejects when coder_url is not a /coder/ path`, async () => {
    const send = vi.fn()
    const ctx = { send } as any
    const tool = createPromptCoderTool(ctx)

    const wrongPrefix = await tool.execute(`call-2`, {
      coder_url: `/horton/abc`,
      prompt: `hi`,
    })
    expect((wrongPrefix.content[0] as { text: string }).text).toMatch(
      /coder_url must be a path like/i
    )
    expect(wrongPrefix.details).toEqual({ sent: false })

    const empty = await tool.execute(`call-3`, {
      coder_url: ``,
      prompt: `hi`,
    })
    expect((empty.content[0] as { text: string }).text).toMatch(
      /coder_url must be a path like/i
    )

    expect(send).not.toHaveBeenCalled()
  })

  it(`rejects when prompt is missing or empty`, async () => {
    const send = vi.fn()
    const ctx = { send } as any
    const tool = createPromptCoderTool(ctx)

    const missing = await tool.execute(`call-4`, {
      coder_url: `/coder/abc`,
    } as any)
    expect((missing.content[0] as { text: string }).text).toMatch(
      /prompt is required/i
    )

    const empty = await tool.execute(`call-5`, {
      coder_url: `/coder/abc`,
      prompt: ``,
    })
    expect((empty.content[0] as { text: string }).text).toMatch(
      /prompt is required/i
    )

    expect(send).not.toHaveBeenCalled()
  })

  it(`returns an error result when send throws`, async () => {
    const send = vi.fn(() => {
      throw new Error(`network boom`)
    })
    const ctx = { send } as any
    const tool = createPromptCoderTool(ctx)
    const result = await tool.execute(`call-6`, {
      coder_url: `/coder/abc`,
      prompt: `hi`,
    })

    expect((result.content[0] as { text: string }).text).toMatch(
      /Error sending prompt to coder/i
    )
    expect((result.content[0] as { text: string }).text).toContain(
      `network boom`
    )
    expect(result.details).toEqual({ sent: false })
  })
})
