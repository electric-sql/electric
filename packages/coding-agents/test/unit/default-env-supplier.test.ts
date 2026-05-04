import { describe, it, expect } from 'vitest'
import { defaultEnvSupplier } from '../../src/entity/register'
// Side-effect imports register the built-in adapters.
import '../../src/agents/claude'
import '../../src/agents/codex'
import '../../src/agents/opencode'

describe(`defaultEnvSupplier`, () => {
  describe(`claude`, () => {
    it(`forwards ANTHROPIC_API_KEY when value is a plain API key`, () => {
      const out = defaultEnvSupplier(`claude`, {
        ANTHROPIC_API_KEY: `sk-ant-api03-abcdef`,
      })
      expect(out.ANTHROPIC_API_KEY).toBe(`sk-ant-api03-abcdef`)
      // No OAuth promotion for plain keys.
      expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    })

    it(`forwards CLAUDE_CODE_OAUTH_TOKEN when set explicitly`, () => {
      const out = defaultEnvSupplier(`claude`, {
        CLAUDE_CODE_OAUTH_TOKEN: `sk-ant-oat01-fromenv`,
      })
      expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(`sk-ant-oat01-fromenv`)
    })

    it(`promotes OAuth-shaped ANTHROPIC_API_KEY to CLAUDE_CODE_OAUTH_TOKEN and drops ANTHROPIC_API_KEY`, () => {
      // Repro for the failure mode where dev-server's ANTHROPIC_API_KEY
      // is actually an OAuth access token. Claude prefers
      // ANTHROPIC_API_KEY when both are present and treats the value as
      // a plain API key, producing "Invalid API key" 401s. The supplier
      // must strip ANTHROPIC_API_KEY so claude takes the OAuth path.
      const out = defaultEnvSupplier(`claude`, {
        ANTHROPIC_API_KEY: `sk-ant-oat01-EXAMPLE`,
      })
      expect(out.ANTHROPIC_API_KEY).toBeUndefined()
      expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(`sk-ant-oat01-EXAMPLE`)
    })

    it(`prefers an explicit CLAUDE_CODE_OAUTH_TOKEN over an OAuth-shaped ANTHROPIC_API_KEY`, () => {
      const out = defaultEnvSupplier(`claude`, {
        ANTHROPIC_API_KEY: `sk-ant-oat01-OLD`,
        CLAUDE_CODE_OAUTH_TOKEN: `sk-ant-oat01-NEW`,
      })
      expect(out.ANTHROPIC_API_KEY).toBeUndefined()
      expect(out.CLAUDE_CODE_OAUTH_TOKEN).toBe(`sk-ant-oat01-NEW`)
    })

    it(`returns an empty object when no relevant env vars are set`, () => {
      const out = defaultEnvSupplier(`claude`, {})
      expect(out).toEqual({})
    })
  })

  describe(`opencode`, () => {
    it(`forwards both ANTHROPIC_API_KEY and OPENAI_API_KEY without OAuth promotion`, () => {
      const out = defaultEnvSupplier(`opencode`, {
        ANTHROPIC_API_KEY: `sk-ant-oat01-EXAMPLE`,
        OPENAI_API_KEY: `sk-openai-EXAMPLE`,
      })
      // OAuth promotion is claude-specific; opencode keeps both keys.
      expect(out.ANTHROPIC_API_KEY).toBe(`sk-ant-oat01-EXAMPLE`)
      expect(out.OPENAI_API_KEY).toBe(`sk-openai-EXAMPLE`)
    })
  })
})
