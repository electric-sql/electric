import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createBuiltinAgentHandler } from '../src/bootstrap'

const originalEnv = { ...process.env }

describe(`bootstrap registers PR shepherd entities`, () => {
  beforeEach(() => {
    // Mock fetch to return valid model responses
    vi.stubGlobal(
      `fetch`,
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [{ id: `claude-sonnet-4-6` }, { id: `gpt-4.1` }],
        }),
      }))
    )
    process.env = { ...originalEnv }
    process.env.ANTHROPIC_API_KEY = `test-anthropic-key`
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    vi.unstubAllGlobals()
  })

  it(`exposes all five entity type names`, async () => {
    const result = await createBuiltinAgentHandler({
      agentServerUrl: `http://localhost:0`,
    })
    expect(result).not.toBeNull()
    expect(result!.typeNames).toEqual(
      expect.arrayContaining([
        `horton`,
        `worker`,
        `pr-watcher`,
        `pr-manager`,
        `pr-reviewer`,
        `pr-build-doctor`,
        `pr-doc-editor`,
      ])
    )
  })
})
