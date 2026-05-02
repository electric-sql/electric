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
})

runCodingAgentsIntegrationConformance(`FlySpriteProvider`, {
  createProvider: () => new FlySpriteProvider(),
  scratchWorkspace: async () => ({
    spec: { type: `volume`, name: `conf-sprite-${randId()}` } as const,
    cleanup: async () => undefined,
  }),
  bridge: () => new StdioBridge(),
  envForKind: (kind) => {
    if (kind === `claude`)
      return process.env.ANTHROPIC_API_KEY
        ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }
        : null
    if (kind === `codex`)
      return process.env.OPENAI_API_KEY
        ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY }
        : null
    if (kind === `opencode`) {
      const env: Record<string, string> = {}
      if (process.env.ANTHROPIC_API_KEY)
        env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
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
})
