import { log } from './log'
import type {
  Bridge,
  RecoveredSandbox,
  SandboxInstance,
  SandboxProvider,
  SandboxSpec,
} from './types'

export interface LifecycleManagerDeps {
  provider: SandboxProvider
  bridge: Bridge
}

export class LifecycleManager {
  readonly provider: SandboxProvider
  readonly bridge: Bridge
  /** Wall-clock ms captured at construction. Used to detect orphan runs. */
  readonly startedAtMs: number

  private readonly idleTimers = new Map<string, NodeJS.Timeout>()
  private readonly pinCounts = new Map<string, number>()

  constructor(deps: LifecycleManagerDeps) {
    this.provider = deps.provider
    this.bridge = deps.bridge
    this.startedAtMs = Date.now()
  }

  // ── sandbox lifecycle ──

  async ensureRunning(spec: SandboxSpec): Promise<SandboxInstance> {
    return this.provider.start(spec)
  }

  async stop(agentId: string): Promise<void> {
    this.cancelIdleTimer(agentId)
    // The provider.destroy/stop interface is keyed by instanceId, not agentId.
    // We rely on provider.destroy(agentId) which finds + removes by label.
    await this.provider.destroy(agentId).catch((err) => {
      log.warn(
        { err, agentId },
        `lifecycleManager.stop: provider.destroy failed`
      )
    })
  }

  async destroy(agentId: string): Promise<void> {
    await this.stop(agentId)
    this.pinCounts.delete(agentId)
  }

  async adoptRunningContainers(): Promise<Array<RecoveredSandbox>> {
    return this.provider.recover()
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
