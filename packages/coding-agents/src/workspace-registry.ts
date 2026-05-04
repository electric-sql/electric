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
  private readonly acquirersByIdentity = new Map<string, number>()

  static async resolveIdentity(
    agentId: string,
    spec:
      | { type: `volume`; name?: string }
      | { type: `bindMount`; hostPath: string },
    target: `sandbox` | `host` | `sprites` = `sandbox`
  ): Promise<{ identity: string; resolved: ResolvedWorkspaceSpec }> {
    if (target === `sprites`) {
      // One sprite per agent; the sprite IS the workspace. workspace.name is
      // informational; identity is per-agent.
      if (spec.type !== `volume`) {
        throw new Error(`sprites only support workspace.type='volume'`)
      }
      return {
        identity: `sprite:${agentId}`,
        resolved: { type: `volume`, name: spec.name ?? agentId },
      }
    }
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
   * When the last acquirer releases, the chain entry is dropped to avoid
   * unbounded promise chains for long-lived workspaces.
   */
  acquire(identity: string): Promise<() => void> {
    this.acquirersByIdentity.set(
      identity,
      (this.acquirersByIdentity.get(identity) ?? 0) + 1
    )
    const prior = this.chainByIdentity.get(identity) ?? Promise.resolve()
    let releaseFn!: () => void
    const next = new Promise<void>((res) => {
      releaseFn = res
    })
    const link = prior.then(() => next)
    this.chainByIdentity.set(identity, link)
    return prior.then(() => () => {
      const remaining = (this.acquirersByIdentity.get(identity) ?? 1) - 1
      if (remaining === 0) {
        this.acquirersByIdentity.delete(identity)
        // Only delete if no concurrent acquirer chained onto our link.
        if (this.chainByIdentity.get(identity) === link) {
          this.chainByIdentity.delete(identity)
        }
      } else {
        this.acquirersByIdentity.set(identity, remaining)
      }
      releaseFn()
    })
  }

  rebuild(snapshots: Array<{ identity: string; agentId: string }>): void {
    this.refsByIdentity.clear()
    this.chainByIdentity.clear()
    this.acquirersByIdentity.clear()
    for (const { identity, agentId } of snapshots) {
      this.register(identity, agentId)
    }
  }
}
