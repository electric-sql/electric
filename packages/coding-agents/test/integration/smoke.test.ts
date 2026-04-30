import { describe, expect, beforeAll, afterAll, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { loadTestEnv } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`coding-agents smoke (real Docker + real Claude)`, () => {
  const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
  const bridge = new StdioBridge()
  const agentId = `/test/coding-agent/${Date.now().toString(36)}`
  const events: Array<NormalizedEvent> = []

  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  afterAll(async () => {
    await provider.destroy(agentId).catch(() => undefined)
  })

  it(`starts a sandbox, runs claude, captures session_init + assistant_message`, async () => {
    const env = loadTestEnv()
    const sandbox = await provider.start({
      agentId,
      kind: `claude`,
      workspace: { type: `volume`, name: agentId.replace(/[^a-z0-9-]/gi, `-`) },
      env: { ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY },
    })

    const result = await bridge.runTurn({
      sandbox,
      kind: `claude`,
      prompt: `Reply with the single word: ok`,
      model: env.ANTHROPIC_MODEL,
      onEvent: (e) => events.push(e),
    })

    expect(result.exitCode).toBe(0)
    expect(events.find((e) => e.type === `session_init`)).toBeTruthy()
    expect(events.find((e) => e.type === `assistant_message`)).toBeTruthy()
    // sanity: response text isn't empty
    expect(result.finalText && result.finalText.length > 0).toBe(true)
  }, 180_000)
})
