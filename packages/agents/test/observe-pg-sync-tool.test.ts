import { describe, expect, it, vi } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { pgSync } from '@electric-ax/agents-runtime'
import { createHortonTools } from '../src/agents/horton'
import { createObservePgSyncTool } from '../src/tools/observe-pg-sync'

function textResult(result: unknown): any {
  const text = (result as { content: Array<{ text: string }> }).content[0]!.text
  return JSON.parse(text)
}

describe(`observe_pg_sync tool`, () => {
  it(`validates required url and table`, async () => {
    const tool = createObservePgSyncTool({ observe: vi.fn() } as any)

    expect(Value.Check(tool.parameters as any, {})).toBe(false)
    expect(Value.Check(tool.parameters as any, { table: `todos` })).toBe(false)
    await expect(tool.execute(`call`, {})).rejects.toThrow(/url is required/)
    await expect(tool.execute(`call`, { table: `todos` })).rejects.toThrow(
      /url is required/
    )
  })

  it(`rejects invalid ops and unsupported timeoutMs when schema validates`, () => {
    const tool = createObservePgSyncTool({ observe: vi.fn() } as any)

    expect(
      Value.Check(tool.parameters as any, {
        table: `todos`,
        wake: { ops: [`merge`] },
      })
    ).toBe(false)
    expect(
      Value.Check(tool.parameters as any, {
        table: `todos`,
        wake: { timeoutMs: 1000 },
      })
    ).toBe(false)
  })

  it(`calls ctx.observe with pgSync source and wake options`, async () => {
    const observe = vi.fn(async () => ({
      sourceType: `pgSync`,
      sourceRef: `registered-ref`,
      streamUrl: `/_electric/pg-sync/default/registered-ref`,
      events: [],
    }))
    const tool = createObservePgSyncTool({ observe } as any)

    await tool.execute(`call`, {
      url: `http://localhost:30000/v1/shape`,
      table: `todos`,
      columns: [`id`, `text`],
      where: `priority = $1`,
      params: [`high`],
      replica: `full`,
      wake: { ops: [`insert`], debounceMs: 25 },
    })

    const expectedSource = pgSync({
      url: `http://localhost:30000/v1/shape`,
      table: `todos`,
      columns: [`id`, `text`],
      where: `priority = $1`,
      params: [`high`],
      replica: `full`,
    })
    expect(observe).toHaveBeenCalledTimes(1)
    const observeCalls = observe.mock.calls as unknown as Array<
      [unknown, unknown]
    >
    expect(observeCalls[0]![0]).toMatchObject({
      sourceType: expectedSource.sourceType,
      sourceRef: expectedSource.sourceRef,
      streamUrl: expectedSource.streamUrl,
      options: expectedSource.options,
    })
    expect(observeCalls[0]![1]).toEqual({
      wake: {
        on: `change`,
        ops: [`insert`],
        debounceMs: 25,
      },
    })
  })

  it(`preserves debounceMs: 0`, async () => {
    const observe = vi.fn(async () => ({
      sourceType: `pgSync`,
      sourceRef: `registered-ref`,
      streamUrl: `/_electric/pg-sync/default/registered-ref`,
      events: [],
    }))
    const tool = createObservePgSyncTool({ observe } as any)

    const result = textResult(
      await tool.execute(`call`, {
        url: `http://localhost:30000/v1/shape`,
        table: `todos`,
        wake: { debounceMs: 0 },
      })
    )

    expect(observe).toHaveBeenCalledWith(expect.anything(), {
      wake: { on: `change`, debounceMs: 0 },
    })
    expect(result.wake).toEqual({ on: `change`, debounceMs: 0 })
  })

  it(`returns the observed sourceRef, streamUrl, and wake`, async () => {
    const observe = vi.fn(async () => ({
      sourceType: `pgSync`,
      sourceRef: `registered-ref`,
      streamUrl: `/_electric/pg-sync/default/registered-ref`,
      events: [],
    }))
    const tool = createObservePgSyncTool({ observe } as any)

    const result = textResult(
      await tool.execute(`call`, {
        url: `http://localhost:30000/v1/shape`,
        table: `todos`,
        wake: { ops: [`delete`] },
      })
    )

    expect(result).toEqual({
      sourceRef: `registered-ref`,
      streamUrl: `/_electric/pg-sync/default/registered-ref`,
      wake: { on: `change`, ops: [`delete`] },
    })
  })

  it(`defaults wake when wake.ops is omitted`, async () => {
    const observe = vi.fn(async () => ({
      sourceType: `pgSync`,
      sourceRef: `registered-ref`,
      streamUrl: `/_electric/pg-sync/default/registered-ref`,
      events: [],
    }))
    const tool = createObservePgSyncTool({ observe } as any)

    const result = textResult(
      await tool.execute(`call`, {
        url: `http://localhost:30000/v1/shape`,
        table: `todos`,
      })
    )

    expect(observe).toHaveBeenCalledWith(expect.anything(), {
      wake: { on: `change` },
    })
    expect(result.wake).toEqual({ on: `change` })
  })

  it(`is included in Horton's tool list`, () => {
    const tools = createHortonTools(
      { workingDirectory: `/tmp` } as any,
      { send: vi.fn(), observe: vi.fn() } as any,
      new Set()
    )

    expect(tools.map((tool) => tool.name)).toContain(`observe_pg_sync`)
  })
})
