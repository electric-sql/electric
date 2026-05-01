import { describe, expect, beforeAll, afterAll, it } from 'vitest'
import type { NormalizedEvent } from 'agent-session-protocol'
import { LocalDockerProvider } from '../../src/providers/local-docker'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import { buildTestImage, TEST_IMAGE_TAG } from '../support/build-image'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.DOCKER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`coding-agents smoke (real Docker)`, () => {
  beforeAll(async () => {
    await buildTestImage()
  }, 600_000)

  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`smoke — ${kind}`, () => {
      const provider = new LocalDockerProvider({ image: TEST_IMAGE_TAG })
      const bridge = new StdioBridge()
      const agentId = `/test/coding-agent/${kind}-${Date.now().toString(36)}`
      const events: Array<NormalizedEvent> = []

      afterAll(async () => {
        await provider.destroy(agentId).catch(() => undefined)
      })

      it(`runs ${kind} CLI; captures session_init + assistant_message`, async () => {
        const sandbox = await provider.start({
          agentId,
          kind,
          target: `sandbox`,
          workspace: {
            type: `volume`,
            name: agentId.replace(/[^a-z0-9-]/gi, `-`),
          },
          env: kindEnv!,
        })
        const probe = probeForKind(env, kind)
        const result = await bridge.runTurn({
          sandbox,
          kind,
          prompt: probe.prompt,
          model: probe.model,
          onEvent: (e) => events.push(e),
        })
        expect(result.exitCode).toBe(0)
        expect(events.find((e) => e.type === `session_init`)).toBeTruthy()
        expect(events.find((e) => e.type === `assistant_message`)).toBeTruthy()
        expect((result.finalText ?? ``).length).toBeGreaterThan(0)
        expect(result.finalText ?? ``).toMatch(probe.expectsResponseMatching)
      }, 180_000)
    })
  }
})
