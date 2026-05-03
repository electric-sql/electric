import {
  runSandboxProviderConformance,
  runCodingAgentsIntegrationConformance,
} from '../../src/conformance'
import { FlySpriteProvider, StdioBridge } from '../../src'

const SPRITES_ENABLED =
  process.env.SPRITES === `1` && !!process.env.SPRITES_TOKEN

// Lightweight id generator — avoids pulling nanoid in just for tests.
const randId = (n = 8): string =>
  Math.random()
    .toString(36)
    .slice(2, 2 + n)

runSandboxProviderConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: async () => ({
    spec: { type: `volume`, name: `conf-sprite-${randId()}` } as const,
    // Cleanup happens via provider.destroy() on the agentId. Since
    // the conformance harness uses one agentId per scenario, that
    // already covers it.
    cleanup: async () => undefined,
  }),
  target: `sprites`,
  skipIf: () => !SPRITES_ENABLED,
  supportsCloneWorkspace: false,
  // L1.4 (recover) is lossy for sprites because spriteName() collapses
  // the agentId path-segments to dashes (sprites require [a-z0-9-]+),
  // so the round-trip from sprite name back to the conformance harness's
  // multi-segment agentId can't be reconstructed exactly. Production
  // agentIds are single-segment ('/coding-agent/<id>') and round-trip
  // cleanly; this only affects the test harness.
  supportsRecovery: false,
})

runCodingAgentsIntegrationConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: async () => ({
    spec: { type: `volume`, name: `conf-sprite-${randId()}` } as const,
    cleanup: async () => undefined,
  }),
  bridge: () => new StdioBridge(),
  envForKind: (kind) => {
    // Mirror the OAuth-token logic from register.ts's default env()
    // callback. The fixture builds the FlySpriteProvider directly and
    // bypasses register.ts, so without this the claude CLI on sprites
    // reports apiKeySource:"none" when ANTHROPIC_API_KEY is shaped as
    // an OAuth subscription token (sk-ant-oat...).
    const claudeAuthEnv = (): Record<string, string> => {
      const out: Record<string, string> = {}
      const anth = process.env.ANTHROPIC_API_KEY
      const oat = process.env.CLAUDE_CODE_OAUTH_TOKEN
      if (anth) out.ANTHROPIC_API_KEY = anth
      if (oat) out.CLAUDE_CODE_OAUTH_TOKEN = oat
      else if (anth && anth.startsWith(`sk-ant-oat`))
        out.CLAUDE_CODE_OAUTH_TOKEN = anth
      return out
    }
    if (kind === `claude`) {
      const env = claudeAuthEnv()
      return Object.keys(env).length > 0 ? env : null
    }
    if (kind === `codex`)
      return process.env.OPENAI_API_KEY
        ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
        : null
    if (kind === `opencode`) {
      const env: Record<string, string> = { ...claudeAuthEnv() }
      if (process.env.OPENAI_API_KEY)
        env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
      return Object.keys(env).length > 0 ? env : null
    }
    return null
  },
  probeForKind: (kind) => {
    if (kind === `claude`)
      return {
        prompt: `Reply with: ok`,
        expectsResponseMatching: /ok/i,
        model: `claude-haiku-4-5`,
      }
    if (kind === `codex`)
      return {
        prompt: `Reply with: ok`,
        expectsResponseMatching: /ok/i,
        model: `gpt-5-codex-latest`,
      }
    return {
      prompt: `Reply with just: ok`,
      expectsResponseMatching: /ok/i,
      model: `openai/gpt-5.4-mini-fast`,
    }
  },
  target: `sprites`,
  skipIf: () => !SPRITES_ENABLED,
  // L2.5 / L2.6 require workspace persistence across destroy and shared
  // lease semantics. For sprites the sandbox IS the workspace — each
  // agentId gets a unique sprite, the FS lives inside it, destroy
  // deletes the sprite, and two agents can't share. TL-S3 / TL-S4.
  supportsSharedWorkspace: false,
})
