import { describe, expect, it, vi } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`source failure handling`, () => {
  it(`isolates throwing sources and emits a source_failed marker`, async () => {
    const logger = vi.fn()

    const messages = await assembleContext(
      {
        sourceBudget: 10_000,
        sources: {
          good: {
            content: () => `kept`,
            max: 100,
            cache: `stable`,
          },
          bad: {
            content: () => {
              throw new Error(`boom`)
            },
            max: 100,
            cache: `stable`,
          },
        },
      },
      { logger }
    )

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toContain(`kept`)
    expect(output).toMatch(
      /\[source_failed name="bad" reason="exception" error_id="[^"]+"\]/
    )
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        source: `bad`,
        scope: `source`,
        reason: `exception`,
        errorId: expect.any(String),
        detail: expect.stringContaining(`boom`),
      })
    )
  })

  it(`turns non-string non-array sources into a source_failed marker`, async () => {
    const logger = vi.fn()

    const messages = await assembleContext(
      {
        sourceBudget: 10_000,
        sources: {
          good: {
            content: () => `still here`,
            max: 100,
            cache: `stable`,
          },
          bad: {
            content: () => ({ nope: true }) as never,
            max: 100,
            cache: `volatile`,
          },
        },
      },
      { logger }
    )

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toContain(`still here`)
    expect(output).toMatch(
      /\[source_failed name="bad" reason="type_mismatch" error_id="[^"]+"\]/
    )
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        source: `bad`,
        scope: `source`,
        reason: `type_mismatch`,
        errorId: expect.any(String),
        detail: expect.stringContaining(`returned object`),
      })
    )
  })
})
