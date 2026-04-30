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

function fakeProvider(): SandboxProvider & {
  starts: Array<SandboxSpec>
  stops: Array<string>
} {
  const stub: SandboxInstance = {
    instanceId: `inst-1`,
    agentId: ``,
    workspaceMount: `/workspace`,
    async exec(_req: ExecRequest): Promise<ExecHandle> {
      throw new Error(`not used`)
    },
  }
  const fp: any = {
    name: `fake`,
    starts: [] as Array<SandboxSpec>,
    stops: [] as Array<string>,
    async start(spec: SandboxSpec): Promise<SandboxInstance> {
      fp.starts.push(spec)
      return { ...stub, agentId: spec.agentId }
    },
    async stop(instanceId: string): Promise<void> {
      fp.stops.push(instanceId)
    },
    async destroy(_id: string): Promise<void> {},
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

describe(`LifecycleManager pin refcount`, () => {
  it(`increments and decrements with a floor at 0`, () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    expect(lm.pinCount(`a`)).toBe(0)
    expect(lm.pin(`a`).count).toBe(1)
    expect(lm.pin(`a`).count).toBe(2)
    expect(lm.release(`a`).count).toBe(1)
    expect(lm.release(`a`).count).toBe(0)
    // Extra release is clamped
    expect(lm.release(`a`).count).toBe(0)
  })

  it(`resetPinCount clears to 0`, () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    lm.pin(`a`)
    lm.pin(`a`)
    lm.resetPinCount(`a`)
    expect(lm.pinCount(`a`)).toBe(0)
  })
})

describe(`LifecycleManager idle timer`, () => {
  it(`arms and fires onFire after ms elapses`, async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer(`a`, 20, onFire)
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it(`cancelIdleTimer prevents fire`, async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const onFire = vi.fn()
    lm.armIdleTimer(`a`, 20, onFire)
    lm.cancelIdleTimer(`a`)
    await new Promise((r) => setTimeout(r, 50))
    expect(onFire).not.toHaveBeenCalled()
  })

  it(`arming twice cancels prior timer`, async () => {
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const first = vi.fn()
    const second = vi.fn()
    lm.armIdleTimer(`a`, 20, first)
    lm.armIdleTimer(`a`, 20, second)
    await new Promise((r) => setTimeout(r, 50))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalled()
  })
})

describe(`LifecycleManager ensureRunning`, () => {
  it(`forwards to provider.start`, async () => {
    const fp = fakeProvider()
    const lm = new LifecycleManager({ provider: fp, bridge: fakeBridge })
    await lm.ensureRunning({
      agentId: `/x/coding-agent/y`,
      kind: `claude`,
      workspace: { type: `volume`, name: `w` },
      env: { K: `v` },
    })
    expect(fp.starts).toHaveLength(1)
    expect(fp.starts[0]!.agentId).toBe(`/x/coding-agent/y`)
  })
})

describe(`LifecycleManager.startedAtMs`, () => {
  it(`captures a timestamp at construction`, () => {
    const before = Date.now()
    const lm = new LifecycleManager({
      provider: fakeProvider(),
      bridge: fakeBridge,
    })
    const after = Date.now()
    expect(lm.startedAtMs).toBeGreaterThanOrEqual(before)
    expect(lm.startedAtMs).toBeLessThanOrEqual(after)
  })
})
