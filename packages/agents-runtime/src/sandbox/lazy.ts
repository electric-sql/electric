/**
 * Lazy sandbox wrapper — defers the (potentially expensive) provider factory
 * until the sandbox is actually USED. A wake that never runs a tool — a cron
 * tick deciding there is nothing to do, child-status bookkeeping, a drained
 * inbox — then never pays for, or leaks, a provider-side sandbox (e.g. a
 * Docker container). Profile authors wrap their factory:
 *
 *   factory: async (params) =>
 *     lazySandbox({
 *       workingDirectory: `/work`,
 *       factory: () => dockerSandbox({ ... }),
 *       reclaim: params.owner
 *         ? () => reclaimDockerSandboxByKey(params.sandboxKey)
 *         : undefined,
 *     })
 *
 * Materialization is single-flight and retried on failure. Disposing a
 * never-used wrapper is free — except `dispose({ reclaim: true })`, which runs
 * the provider-supplied `reclaim` callback so a terminal entity's persistent
 * workspace from an EARLIER wake is still wiped without creating a fresh
 * sandbox just to remove it.
 */

import { SandboxError } from './types'
import type {
  DirEntry,
  FileStat,
  Sandbox,
  SandboxExecOpts,
  SandboxExecResult,
} from './types'

/**
 * Cross-module-instance brand for {@link ensureSandboxMaterialized}: a global
 * symbol survives duplicate copies of this module in a bundle, where an
 * `instanceof` check would not.
 */
const MATERIALIZE = Symbol.for(`electric.sandbox.lazy.materialize`)

export interface LazySandboxOpts {
  /** Reported as `Sandbox.name` until the inner sandbox materializes. */
  name?: string
  /**
   * The inner sandbox's primary writable root. MUST match what `factory`
   * produces: tools resolve relative paths against it synchronously, before
   * the first (materializing) sandbox call could run.
   */
  workingDirectory: string
  /** Builds the inner sandbox on first use. */
  factory: () => Promise<Sandbox>
  /**
   * Wipe the provider-side sandbox WITHOUT materializing. Invoked when this
   * lease is disposed with `reclaim: true` before the sandbox was ever used —
   * an earlier wake's persistent workspace may still exist under the same key
   * and must not outlive its terminal entity. Only pass this for OWNER leases:
   * the wrapper itself cannot tell an owner from an attacher.
   */
  reclaim?: () => Promise<void>
}

class LazySandbox implements Sandbox {
  private readonly opts: LazySandboxOpts
  private inner: Sandbox | null = null
  private materializing: Promise<Sandbox> | null = null
  private disposed = false

  constructor(opts: LazySandboxOpts) {
    this.opts = opts
  }

  get name(): string {
    return this.inner?.name ?? this.opts.name ?? `lazy`
  }

  get workingDirectory(): string {
    return this.opts.workingDirectory
  }

  /** Single-flight; a failed factory clears so the next use retries. */
  private materialize(): Promise<Sandbox> {
    if (this.inner) return Promise.resolve(this.inner)
    this.materializing ??= this.opts.factory().then(
      (sandbox) => {
        this.inner = sandbox
        this.materializing = null
        return sandbox
      },
      (err: unknown) => {
        this.materializing = null
        throw err
      }
    )
    return this.materializing
  }

  /** @internal see {@link ensureSandboxMaterialized} */
  [MATERIALIZE](): Promise<Sandbox> {
    this.assertLive()
    return this.materialize()
  }

  private assertLive(): void {
    if (this.disposed) {
      throw new SandboxError(
        `runtime`,
        `lazySandbox: this sandbox lease has been disposed.`
      )
    }
  }

  async exec(opts: SandboxExecOpts): Promise<SandboxExecResult> {
    this.assertLive()
    return (await this.materialize()).exec(opts)
  }

  async readFile(path: string): Promise<Buffer> {
    this.assertLive()
    return (await this.materialize()).readFile(path)
  }

  async writeFile(path: string, content: Buffer | string): Promise<void> {
    this.assertLive()
    return (await this.materialize()).writeFile(path, content)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    return (await this.materialize()).mkdir(path, opts)
  }

  async readdir(path: string): Promise<ReadonlyArray<DirEntry>> {
    this.assertLive()
    return (await this.materialize()).readdir(path)
  }

  async exists(path: string): Promise<boolean> {
    this.assertLive()
    return (await this.materialize()).exists(path)
  }

  async remove(path: string, opts?: { recursive?: boolean }): Promise<void> {
    this.assertLive()
    return (await this.materialize()).remove(path, opts)
  }

  async stat(path: string): Promise<FileStat> {
    this.assertLive()
    return (await this.materialize()).stat(path)
  }

  async fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    this.assertLive()
    return (await this.materialize()).fetch(input, init)
  }

  async dispose(opts?: { reclaim?: boolean }): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.inner || this.materializing) {
      let inner: Sandbox | null = null
      try {
        inner = await this.materialize()
      } catch {
        // The in-flight factory failed — nothing live to dispose. Fall
        // through: a requested reclaim still wipes the provider-side state.
      }
      if (inner) {
        // The inner dispose owns the reclaim semantics from here.
        await inner.dispose(opts)
        return
      }
    }
    if (opts?.reclaim && this.opts.reclaim) await this.opts.reclaim()
  }
}

/** Wrap a provider factory so the sandbox materializes on first use. */
export function lazySandbox(opts: LazySandboxOpts): Sandbox {
  return new LazySandbox(opts)
}

/**
 * Force a lazy sandbox to materialize (no-op for any other sandbox). Used by
 * the spawn-`inherit` path: a child ATTACHES to this wake's sandbox by key and
 * never creates, so the owner's container/workspace must actually exist before
 * the child can wake — even if the owner itself never ran a tool.
 */
export async function ensureSandboxMaterialized(
  sandbox: Sandbox
): Promise<void> {
  const materialize = (
    sandbox as Sandbox & { [MATERIALIZE]?: () => Promise<Sandbox> }
  )[MATERIALIZE]
  if (typeof materialize === `function`) await materialize.call(sandbox)
}
