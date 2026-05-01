import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type { SandboxProvider, SandboxSpec } from '../types'

export interface SandboxProviderConformanceConfig {
  /** Constructs a fresh provider instance. Called once per test file. */
  createProvider: () => SandboxProvider | Promise<SandboxProvider>
  /**
   * Returns a scratch workspace plus a cleanup. The suite calls cleanup
   * in an afterEach for the test that consumed it, even on failure.
   */
  scratchWorkspace: () => Promise<{
    spec: SandboxSpec[`workspace`]
    cleanup: () => Promise<void>
  }>
  /** The target the provider is configured for. */
  target: SandboxSpec[`target`]
  /** Skip the entire suite if this returns truthy. */
  skipIf?: () => boolean
  /**
   * If false, L1.4 (`recover` adopts running instances) is skipped
   * because the provider's `recover()` is documented to return `[]`.
   */
  supportsRecovery?: boolean
}

export function runSandboxProviderConformance(
  name: string,
  config: SandboxProviderConformanceConfig
): void {
  const should = !config.skipIf?.()
  const d = should ? describe : describe.skip
  d(`SandboxProvider conformance — ${name}`, () => {
    let provider!: SandboxProvider
    const pendingCleanups: Array<() => Promise<void>> = []

    beforeAll(async () => {
      provider = await config.createProvider()
    })

    afterEach(async () => {
      for (const c of pendingCleanups.splice(0)) {
        await c().catch(() => undefined)
      }
    })

    function specFor(
      agentId: string,
      workspace: SandboxSpec[`workspace`]
    ): SandboxSpec {
      return {
        agentId,
        kind: `claude`,
        target: config.target,
        workspace,
        env: {},
      }
    }

    async function drain(stream: AsyncIterable<string>): Promise<string> {
      let out = ``
      for await (const line of stream) out += line + `\n`
      return out
    }

    async function discardStream(stream: AsyncIterable<string>): Promise<void> {
      for await (const _ of stream) {
        // discard
      }
    }

    it(`L1.1 start is idempotent on agentId`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-1-${Date.now().toString(36)}`
      const a = await provider.start(specFor(agentId, ws))
      try {
        const b = await provider.start(specFor(agentId, ws))
        expect(b.instanceId).toBe(a.instanceId)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)

    it(`L1.2 start after destroy creates fresh instance`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-2-${Date.now().toString(36)}`
      const a = await provider.start(specFor(agentId, ws))
      await provider.destroy(agentId)
      const b = await provider.start(specFor(agentId, ws))
      try {
        expect(b.instanceId).not.toBe(a.instanceId)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)

    it(`L1.3 status reflects lifecycle`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-3-${Date.now().toString(36)}`
      expect(await provider.status(agentId)).toBe(`unknown`)
      await provider.start(specFor(agentId, ws))
      try {
        expect(await provider.status(agentId)).toBe(`running`)
      } finally {
        await provider.destroy(agentId)
      }
      const after = await provider.status(agentId)
      expect([`stopped`, `unknown`]).toContain(after)
    }, 60_000)

    const recoverIt = config.supportsRecovery === false ? it.skip : it
    recoverIt(
      `L1.4 recover adopts running instances`,
      async () => {
        const { spec: ws, cleanup } = await config.scratchWorkspace()
        pendingCleanups.push(cleanup)
        const agentId = `/test/coding-agent/conf-l1-4-${Date.now().toString(36)}`
        await provider.start(specFor(agentId, ws))
        try {
          const fresh = await config.createProvider()
          const recovered = await fresh.recover()
          const found = recovered.find((r) => r.agentId === agentId)
          expect(found).toBeDefined()
          expect(found?.target).toBe(config.target)
        } finally {
          await provider.destroy(agentId).catch(() => undefined)
        }
      },
      60_000
    )

    it(`L1.5 exec honours cwd and env`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-5-${Date.now().toString(36)}`
      const inst = await provider.start(specFor(agentId, ws))
      try {
        // pwd
        const h1 = await inst.exec({
          cmd: [`pwd`],
          cwd: inst.workspaceMount,
        })
        const [pwdOut] = await Promise.all([
          drain(h1.stdout),
          discardStream(h1.stderr),
          h1.wait(),
        ])
        expect(pwdOut.trim()).toBe(inst.workspaceMount)

        // env passthrough
        const h2 = await inst.exec({
          cmd: [`printenv`, `FOO`],
          env: { FOO: `bar` },
        })
        const [envOut] = await Promise.all([
          drain(h2.stdout),
          discardStream(h2.stderr),
          h2.wait(),
        ])
        expect(envOut.trim()).toBe(`bar`)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)

    it(`L1.6 exec stdin pipe round-trip`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-6-${Date.now().toString(36)}`
      const inst = await provider.start(specFor(agentId, ws))
      try {
        const h = await inst.exec({ cmd: [`cat`], stdin: `pipe` })
        if (!h.writeStdin || !h.closeStdin) {
          throw new Error(`provider must support stdin: 'pipe' on exec`)
        }
        await h.writeStdin(`hello\n`)
        await h.closeStdin()
        const [out] = await Promise.all([
          drain(h.stdout),
          discardStream(h.stderr),
          h.wait(),
        ])
        expect(out.trim()).toBe(`hello`)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)

    it(`L1.7 copyTo round-trip`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-7-${Date.now().toString(36)}`
      const inst = await provider.start(specFor(agentId, ws))
      try {
        const dest = `/tmp/conf-l1-7-${Date.now()}.txt`
        await inst.copyTo({ destPath: dest, content: `abc`, mode: 0o600 })
        const h = await inst.exec({ cmd: [`cat`, dest] })
        const [out] = await Promise.all([
          drain(h.stdout),
          discardStream(h.stderr),
          h.wait(),
        ])
        expect(out.trim()).toBe(`abc`)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)

    it(`L1.8 sandbox.homeDir matches exec view of $HOME`, async () => {
      const { spec: ws, cleanup } = await config.scratchWorkspace()
      pendingCleanups.push(cleanup)
      const agentId = `/test/coding-agent/conf-l1-8-${Date.now().toString(36)}`
      const inst = await provider.start(specFor(agentId, ws))
      try {
        const h = await inst.exec({ cmd: [`sh`, `-c`, `echo $HOME`] })
        const [out] = await Promise.all([
          drain(h.stdout),
          discardStream(h.stderr),
          h.wait(),
        ])
        expect(out.trim()).toBe(inst.homeDir)
      } finally {
        await provider.destroy(agentId).catch(() => undefined)
      }
    }, 60_000)
  })
}
