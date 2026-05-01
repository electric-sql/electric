import { describe, it, expect, vi } from 'vitest'
import { LifecycleManager } from '../../src/lifecycle-manager'
import type {
  Bridge,
  ExecHandle,
  ExecRequest,
  RecoveredSandbox,
  RunTurnArgs,
  RunTurnResult,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from '../../src/types'

function fakeProvider(name: `sandbox` | `host`): SandboxProvider & {
  starts: Array<SandboxSpec>
  destroys: Array<string>
} {
  const stub: SandboxInstance = {
    instanceId: `inst-${name}`,
    agentId: ``,
    workspaceMount: `/workspace`,
    async exec(_req: ExecRequest): Promise<ExecHandle> {
      throw new Error(`not used`)
    },
  }
  const fp: any = {
    name,
    starts: [] as Array<SandboxSpec>,
    destroys: [] as Array<string>,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      fp.starts.push(spec)
      return { ...stub, agentId: spec.agentId }
    },
    async stop(_id: string): Promise<void> {},
    async destroy(id: string): Promise<void> {
      fp.destroys.push(id)
    },
    async status(_id: string): Promise<`running` | `stopped` | `unknown`> {
      return `running`
    },
    async recover(): Promise<Array<RecoveredSandbox>> {
      return []
    },
  }
  return fp
}

const fakeBridge: Bridge = {
  async runTurn(_args: RunTurnArgs): Promise<RunTurnResult> {
    return { exitCode: 0 }
  },
}

describe(`LifecycleManager target routing`, () => {
  it(`ensureRunning routes to sandbox provider when spec.target='sandbox'`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.ensureRunning({
      agentId: `/x/coding-agent/y`,
      kind: `claude`,
      target: `sandbox`,
      workspace: { type: `volume`, name: `w` },
      env: {},
    })
    expect(sandbox.starts).toHaveLength(1)
    expect(host.starts).toHaveLength(0)
  })

  it(`ensureRunning routes to host provider when spec.target='host'`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.ensureRunning({
      agentId: `/x/coding-agent/y`,
      kind: `claude`,
      target: `host`,
      workspace: { type: `bindMount`, hostPath: `/tmp` },
      env: {},
    })
    expect(host.starts).toHaveLength(1)
    expect(sandbox.starts).toHaveLength(0)
  })

  it(`statusFor and destroyFor route to the requested target`, async () => {
    const sandbox = fakeProvider(`sandbox`)
    const host = fakeProvider(`host`)
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    await lm.statusFor(`/x/coding-agent/y`, `sandbox`)
    await lm.destroyFor(`/x/coding-agent/y`, `host`)
    expect(host.destroys).toEqual([`/x/coding-agent/y`])
    expect(sandbox.destroys).toEqual([])
  })

  it(`adoptRunningContainers merges results from both providers`, async () => {
    const sandbox = fakeProvider(`sandbox`) as any
    sandbox.recover = async () => [
      { agentId: `/a`, instanceId: `s1`, status: `running`, target: `sandbox` },
    ]
    const host = fakeProvider(`host`) as any
    host.recover = async () => [
      { agentId: `/b`, instanceId: `h1`, status: `running`, target: `host` },
    ]
    const lm = new LifecycleManager({
      providers: { sandbox, host },
      bridge: fakeBridge,
    })
    const adopted = await lm.adoptRunningContainers()
    expect(adopted).toHaveLength(2)
    expect(adopted.map((r) => r.target).sort()).toEqual([`host`, `sandbox`])
  })
})

describe(`LifecycleManager pin refcount`, () => {
  it(`increments and decrements with a floor at 0`, () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: fakeProvider(`sandbox`),
        host: fakeProvider(`host`),
      },
      bridge: fakeBridge,
    })
    expect(lm.pinCount(`a`)).toBe(0)
    expect(lm.pin(`a`).count).toBe(1)
    expect(lm.pin(`a`).count).toBe(2)
    expect(lm.release(`a`).count).toBe(1)
    expect(lm.release(`a`).count).toBe(0)
    expect(lm.release(`a`).count).toBe(0)
  })
})

describe(`LifecycleManager idle timer`, () => {
  it(`arms and fires onFire after ms elapses`, async () => {
    const lm = new LifecycleManager({
      providers: {
        sandbox: fakeProvider(`sandbox`),
        host: fakeProvider(`host`),
      },
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer(`a`, 20, onFire)
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})
