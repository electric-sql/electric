import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HostProvider } from '../../src/providers/host'
import { StdioBridge } from '../../src/bridge/stdio-bridge'
import { listAdapters } from '../../src'
import { envForKind, loadTestEnv, probeForKind } from '../support/env'

const SHOULD_RUN = process.env.HOST_PROVIDER === `1`
const describeMaybe = SHOULD_RUN ? describe : describe.skip

describeMaybe(`HostProvider integration`, () => {
  for (const adapter of listAdapters()) {
    const kind = adapter.kind
    const env = loadTestEnv()
    const kindEnv = envForKind(env, kind)
    const describeKind = kindEnv ? describe : describe.skip

    describeKind(`host — ${kind}`, () => {
      it(`runs a one-turn ${kind} prompt on the host with a bind-mount workspace`, async () => {
        const ws = await mkdtemp(join(tmpdir(), `host-int-${kind}-`))
        const provider = new HostProvider()
        const bridge = new StdioBridge()
        const agentId = `/test/coding-agent/host-int-${kind}-${Date.now().toString(36)}`
        try {
          const sandbox = await provider.start({
            agentId,
            kind,
            target: `host`,
            workspace: { type: `bindMount`, hostPath: ws },
            env: kindEnv!,
          })
          const events: any[] = []
          const probe = probeForKind(env, kind)
          const result = await bridge.runTurn({
            sandbox,
            kind,
            prompt: probe.prompt,
            model: probe.model,
            onEvent: (e) => events.push(e),
          })
          expect(result.exitCode).toBe(0)
          expect(result.nativeSessionId).toBeTruthy()
          const assistant = events.find((e) => e.type === `assistant_message`)
          expect(assistant).toBeDefined()
        } finally {
          await provider.destroy(agentId)
          await rm(ws, { recursive: true, force: true })
        }
      }, 120_000)
    })
  }
})
