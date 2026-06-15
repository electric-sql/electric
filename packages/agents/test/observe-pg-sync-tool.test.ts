import { describe, expect, it, vi } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import { pgSync } from '@electric-ax/agents-runtime'
import { createHortonTools } from '../src/agents/horton'
import { createObservePgSyncTool } from '../src/tools/observe-pg-sync'
import { createUnobservePgSyncTool } from '../src/tools/unobserve-pg-sync'

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
      // getGoal: tool composition is goal-aware (mark_goal_complete is only
      // registered for an active goal), so the ctx stub needs it present.
      {
        send: vi.fn(),
        observe: vi.fn(),
        getGoal: vi.fn(() => undefined),
      } as any,
      new Set()
    )

    expect(tools.map((tool) => tool.name)).toContain(`observe_pg_sync`)
  })
})

function ctxWithObservations(
  observations: Array<{
    sourceRef: string
    table?: string
    url?: string
    streamUrl?: string
  }>,
  unobserve = vi.fn(async () => undefined)
) {
  return {
    unobserve,
    db: {
      collections: {
        manifests: {
          toArray: observations.map((o) => ({
            key: `source:pgSync:${o.sourceRef}`,
            kind: `source`,
            sourceType: `pgSync`,
            sourceRef: o.sourceRef,
            ...(o.streamUrl ? { streamUrl: o.streamUrl } : {}),
            config: {
              ...(o.table ? { table: o.table } : {}),
              ...(o.url ? { url: o.url } : {}),
            },
          })),
        },
      },
    },
  } as any
}

describe(`unobserve_pg_sync tool`, () => {
  it(`lists active observations when called with no arguments`, async () => {
    const tool = createUnobservePgSyncTool(
      ctxWithObservations([
        { sourceRef: `ref-a`, table: `todos`, url: `http://e/v1/shape` },
      ])
    )

    const result = textResult(await tool.execute(`call`, {}))
    expect(result.observations).toEqual([
      {
        sourceRef: `ref-a`,
        table: `todos`,
        url: `http://e/v1/shape`,
      },
    ])
  })

  it(`unobserves by sourceRef`, async () => {
    const unobserve = vi.fn(async () => undefined)
    const tool = createUnobservePgSyncTool(
      ctxWithObservations([{ sourceRef: `ref-a`, table: `todos` }], unobserve)
    )

    const result = textResult(
      await tool.execute(`call`, { sourceRef: `ref-a` })
    )
    expect(unobserve).toHaveBeenCalledWith(`ref-a`)
    expect(result).toEqual({ unobserved: true, sourceRef: `ref-a` })
  })

  it(`resolves a unique table to its sourceRef`, async () => {
    const unobserve = vi.fn(async () => undefined)
    const tool = createUnobservePgSyncTool(
      ctxWithObservations(
        [
          { sourceRef: `ref-a`, table: `todos` },
          { sourceRef: `ref-b`, table: `users` },
        ],
        unobserve
      )
    )

    await tool.execute(`call`, { table: `users` })
    expect(unobserve).toHaveBeenCalledWith(`ref-b`)
  })

  it(`refuses an ambiguous table without unobserving`, async () => {
    const unobserve = vi.fn(async () => undefined)
    const tool = createUnobservePgSyncTool(
      ctxWithObservations(
        [
          { sourceRef: `ref-a`, table: `todos` },
          { sourceRef: `ref-b`, table: `todos` },
        ],
        unobserve
      )
    )

    const result = textResult(await tool.execute(`call`, { table: `todos` }))
    expect(unobserve).not.toHaveBeenCalled()
    expect(result.error).toMatch(/Multiple pg-sync observations/)
  })

  it(`reports not-found for an unknown sourceRef without unobserving`, async () => {
    const unobserve = vi.fn(async () => undefined)
    const tool = createUnobservePgSyncTool(
      ctxWithObservations([{ sourceRef: `ref-a`, table: `todos` }], unobserve)
    )

    const result = await tool.execute(`call`, { sourceRef: `missing` })
    const text = (result as { content: Array<{ text: string }> }).content[0]!
      .text
    expect(unobserve).not.toHaveBeenCalled()
    expect(text).toMatch(/No active pg-sync observation/)
  })

  it(`is included in Horton's tool list`, () => {
    const tools = createHortonTools(
      { workingDirectory: `/tmp` } as any,
      {
        send: vi.fn(),
        observe: vi.fn(),
        getGoal: vi.fn(() => undefined),
      } as any,
      new Set()
    )

    expect(tools.map((tool) => tool.name)).toContain(`unobserve_pg_sync`)
  })
})
