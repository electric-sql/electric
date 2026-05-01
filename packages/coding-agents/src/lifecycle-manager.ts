import { log } from './log'
import type {
  Bridge,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from './types'

export interface LifecycleManagerDeps {
  providers: { sandbox: SandboxProvider; host: SandboxProvider }
  bridge: Bridge
}

export type Target = `sandbox` | `host`

export class LifecycleManager {
  readonly providers: { sandbox: SandboxProvider; host: SandboxProvider }
  readonly bridge: Bridge
  /** Wall-clock ms captured at construction. Used to detect orphan runs. */
  readonly startedAtMs: number

  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  private readonly pinCounts = new Map<string, number>()

  constructor(deps: LifecycleManagerDeps) {
    this.providers = deps.providers
    this.bridge = deps.bridge
    this.startedAtMs = Date.now()
  }

  // ── sandbox lifecycle ──

  async ensureRunning(spec: SandboxSpec): Promise<SandboxInstance> {
    return this.providers[spec.target].start(spec)
  }

  async statusFor(
    agentId: string,
    target: Target
  ): Promise<`running` | `stopped` | `unknown`> {
    return this.providers[target].status(agentId)
  }

  async destroyFor(agentId: string, target: Target): Promise<void> {
    this.cancelIdleTimer(agentId)
    await this.providers[target].destroy(agentId).catch((err) => {
      log.warn({ err, agentId, target }, `lifecycleManager.destroyFor failed`)
    })
  }

  async stopFor(agentId: string, target: Target): Promise<void> {
    this.cancelIdleTimer(agentId)
    await this.providers[target].destroy(agentId).catch((err) => {
      log.warn({ err, agentId, target }, `lifecycleManager.stopFor failed`)
    })
  }

  async destroyAndForget(agentId: string, target: Target): Promise<void> {
    await this.destroyFor(agentId, target)
    this.pinCounts.delete(agentId)
  }

  async adoptRunningContainers(): Promise<Array<RecoveredSandbox>> {
    const [a, b] = await Promise.all([
      this.providers.sandbox.recover(),
      this.providers.host.recover(),
    ])
    return [...a, ...b]
  }

  // ── idle timer ──

  armIdleTimer(agentId: string, ms: number, onFire: () => void): void {
    this.cancelIdleTimer(agentId)
    const handle = setTimeout(() => {
      this.idleTimers.delete(agentId)
      try {
        onFire()
      } catch (err) {
        log.warn({ err, agentId }, `idle timer onFire threw`)
      }
    }, ms)
    this.idleTimers.set(agentId, handle)
  }

  cancelIdleTimer(agentId: string): void {
    const handle = this.idleTimers.get(agentId)
    if (handle) {
      clearTimeout(handle)
      this.idleTimers.delete(agentId)
    }
  }

  // ── pin refcount ──

  pin(agentId: string): { count: number } {
    const next = (this.pinCounts.get(agentId) ?? 0) + 1
    this.pinCounts.set(agentId, next)
    if (next === 1) this.cancelIdleTimer(agentId)
    return { count: next }
  }

  release(agentId: string): { count: number } {
    const cur = this.pinCounts.get(agentId) ?? 0
    const next = Math.max(0, cur - 1)
    if (next === 0) this.pinCounts.delete(agentId)
    else this.pinCounts.set(agentId, next)
    return { count: next }
  }

  pinCount(agentId: string): number {
    return this.pinCounts.get(agentId) ?? 0
  }

  resetPinCount(agentId: string): void {
    this.pinCounts.delete(agentId)
  }
}
