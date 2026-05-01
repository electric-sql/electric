import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostProvider } from '../../src/providers/host'
import { StdioBridge } from '../../src/bridge/stdio-bridge'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`HostProvider integration`, () => {
  it(`runs a one-turn claude prompt on the host with a bind-mount workspace`, async () => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error(`ANTHROPIC_API_KEY required for integration`)
    const ws = await mkdtemp(join(tmpdir(), `host-int-`))
    const provider = new HostProvider()
    const bridge = new StdioBridge()
    const agentId = `/test/coding-agent/host-int-${Date.now().toString(36)}`
    try {
      const sandbox = await provider.start({
        agentId,
        kind: `claude`,
        target: `host`,
        workspace: { type: `bindMount`, hostPath: ws },
        env: { ANTHROPIC_API_KEY: apiKey },
      })
      const events: any[] = []
      const result = await bridge.runTurn({
        sandbox,
        kind: `claude`,
        prompt: `reply with the single word: ok`,
        model: `claude-haiku-4-5-20251001`,
        onEvent: (e) => events.push(e),
      })
      expect(result.exitCode).toBe(0)
      expect(result.nativeSessionId).toBeTruthy()
      // claude wrote the transcript into the user's home
      // (we don't assert the exact path — just that some assistant_message arrived).
      const assistant = events.find((e) => e.type === `assistant_message`)
      expect(assistant).toBeDefined()
    } finally {
      await provider.destroy(agentId)
      await rm(ws, { recursive: true, force: true })
    }
  }, 120_000)
})
