import { realpath } from 'node:fs/promises'

export type ResolvedWorkspaceSpec =
  | { type: `volume`; name: string }
  | { type: `bindMount`; hostPath: string }

/**
 * Docker volume names must match `[a-zA-Z0-9][a-zA-Z0-9_.-]*`. Entity URLs
 * (the agentId) include `/` and other invalid characters, so we slugify
 * before using them as a default volume name.
 */
function slugifyForVolumeName(s: string): string {
  return s
    .replace(/[^a-zA-Z0-9_.-]/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^[-_.]+/, ``)
    .replace(/[-_.]+$/, ``)
}

export class WorkspaceRegistry {
  private readonly refsByIdentity = new Map<string, Set<string>>()
  private readonly chainByIdentity = new Map<string, Promise<void>>()

  static async resolveIdentity(
    agentId: string,
    spec:
      | { type: `volume`; name?: string }
      | { type: `bindMount`; hostPath: string }
  ): Promise<{ identity: string; resolved: ResolvedWorkspaceSpec }> {
    if (spec.type === `volume`) {
      const name = spec.name ?? slugifyForVolumeName(agentId)
      return {
        identity: `volume:${name}`,
        resolved: { type: `volume`, name },
      }
    }
    const real = await realpath(spec.hostPath)
    return {
      identity: `bindMount:${real}`,
      resolved: { type: `bindMount`, hostPath: real },
    }
  }

  register(identity: string, agentId: string): void {
    let set = this.refsByIdentity.get(identity)
    if (!set) {
      set = new Set()
      this.refsByIdentity.set(identity, set)
    }
    set.add(agentId)
  }

  release(identity: string, agentId: string): void {
    const set = this.refsByIdentity.get(identity)
    if (!set) return
    set.delete(agentId)
    if (set.size === 0) this.refsByIdentity.delete(identity)
  }

  refs(identity: string): number {
    return this.refsByIdentity.get(identity)?.size ?? 0
  }

  /**
   * Acquire the per-identity mutex. Returns a release fn.
   * The mutex chains promises: each acquire waits for the prior chain to settle.
   */
  acquire(identity: string): Promise<() => void> {
    const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
    let releaseFn: () => void
    const next = new Promise<void>((res) => {
      releaseFn = res
    })
    this.chainByIdentity.set(
      identity,
      prior.then(() => next)
    )
    return prior.then(() => releaseFn!)
  }

  rebuild(snapshots: Array<{ identity: string; agentId: string }>): void {
    this.refsByIdentity.clear()
    this.chainByIdentity.clear()
    for (const { identity, agentId } of snapshots) {
      this.register(identity, agentId)
    }
  }
}
