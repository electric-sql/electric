import { describe, expect, it, vi } from 'vitest'
import { createSpawnCodingAgentTool } from '../src/tools/spawn-coding-agent'

describe(`spawn_coding_agent tool`, () => {
  it(`spawns a coding-agent with kind='claude' by default`, async () => {
    const spawn = vi.fn(
      async (type: string, id: string, _args?: unknown, _opts?: unknown) => ({
        entityUrl: `/${type}/${id}`,
        writeToken: `tok`,
        txid: 1,
      })
    )
    const ctx = { spawn } as any
    const tool = createSpawnCodingAgentTool(ctx)
    const result = await tool.execute(`call-1`, {
      prompt: `Refactor the foo module`,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const call = spawn.mock.calls[0]!
    const [type, id, args, opts] = call as Array<any>
    expect(type).toBe(`coding-agent`)
    expect(typeof id).toBe(`string`)
    expect(args).toMatchObject({ kind: `claude`, workspaceType: `volume` })
    expect(opts).toEqual({
      initialMessage: { text: `Refactor the foo module` },
      wake: { on: `runFinished`, includeResponse: true },
    })

    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Coding agent dispatched/)
    expect(text).toContain(`/coding-agent/${id}`)
  })

  it(`accepts kind='codex' and forwards it to spawn`, async () => {
    const spawn = vi.fn(
      async (type: string, id: string, _args?: unknown, _opts?: unknown) => ({
        entityUrl: `/${type}/${id}`,
        writeToken: `tok`,
        txid: 1,
      })
    )
    const ctx = { spawn } as any
    const tool = createSpawnCodingAgentTool(ctx)
    await tool.execute(`call-codex`, {
      prompt: `Investigate bug`,
      kind: `codex`,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const args = spawn.mock.calls[0]![2] as Record<string, unknown>
    expect(args.kind).toBe(`codex`)
  })

  it(`accepts kind='claude' explicitly`, async () => {
    const spawn = vi.fn(
      async (type: string, id: string, _args?: unknown, _opts?: unknown) => ({
        entityUrl: `/${type}/${id}`,
        writeToken: `tok`,
        txid: 1,
      })
    )
    const ctx = { spawn } as any
    const tool = createSpawnCodingAgentTool(ctx)
    await tool.execute(`call-claude`, {
      prompt: `Do a thing`,
      kind: `claude`,
    })

    expect(spawn).toHaveBeenCalledTimes(1)
    const args = spawn.mock.calls[0]![2] as Record<string, unknown>
    expect(args.kind).toBe(`claude`)
  })

  it(`exposes kind in the tool's input schema as an enum of claude/codex`, () => {
    const ctx = { spawn: vi.fn() } as any
    const tool = createSpawnCodingAgentTool(ctx)
    // typebox schemas have a Type.Object structure with `properties`
    const schema = tool.parameters as {
      properties: Record<string, { enum?: ReadonlyArray<string> }>
    }
    expect(schema.properties.kind).toBeDefined()
    const kindSchema = schema.properties.kind as {
      enum?: ReadonlyArray<string>
      anyOf?: ReadonlyArray<{ const?: string }>
    }
    // typebox's Type.Union of Type.Literal yields anyOf with const values; an enum yields enum.
    const values = kindSchema.enum
      ? Array.from(kindSchema.enum)
      : (kindSchema.anyOf ?? [])
          .map((s) => s.const)
          .filter((v): v is string => typeof v === `string`)
    expect(values.sort()).toEqual([`claude`, `codex`])
  })

  it(`mentions codex (or both kinds) in the description`, () => {
    const ctx = { spawn: vi.fn() } as any
    const tool = createSpawnCodingAgentTool(ctx)
    expect(tool.description.toLowerCase()).toMatch(/codex/)
  })

  it(`rejects when prompt is missing or empty`, async () => {
    const spawn = vi.fn()
    const ctx = { spawn } as any
    const tool = createSpawnCodingAgentTool(ctx)
    const empty = await tool.execute(`call-empty`, { prompt: `` })
    expect((empty.content[0] as { text: string }).text).toMatch(
      /prompt is required/i
    )
    expect(spawn).not.toHaveBeenCalled()
  })
})
