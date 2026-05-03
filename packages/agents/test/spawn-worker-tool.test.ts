import { describe, expect, it, vi } from 'vitest'
import { createSpawnWorkerTool } from '../src/tools/spawn-worker'

describe(`spawn_worker tool`, () => {
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
    expect(id.length).toBeGreaterThanOrEqual(10)
    expect(args).toEqual({
      systemPrompt: `Read /tmp/foo and report its size`,
      tools: [`read`, `bash`],
    })
    expect(opts).toEqual({
      initialMessage: `Please check the size of /tmp/foo and report back`,
      wake: { on: `runFinished`, includeResponse: true },
    })

    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Worker dispatched/)
    expect(text).toContain(`/worker/${id}`)
    expect(text).toMatch(/end your turn/i)
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
